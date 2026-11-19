'use client';

import type { Track } from './types';

export type PlaybackErrorCode = 'unsupported' | 'network' | 'decode' | 'blocked' | 'unknown';

export interface PlaybackError {
  code: PlaybackErrorCode;
  message: string;
}

export type EngineStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface PlayerEngineCallbacks {
  /** Called from requestAnimationFrame while playing, and on seek/pause. */
  onProgress: (positionSec: number, durationSec: number) => void;
  onEnded: () => void;
  /** Fired when the browser reports a duration the library did not know. */
  onMetadata?: (durationSec: number) => void;
  onError?: (error: PlaybackError) => void;
  onStatusChange?: (status: EngineStatus) => void;
}

const DEFAULT_DURATION = 192;
const PROGRESS_INTERVAL_MS = 80;

/**
 * Plays files from the loopback media server through one HTMLAudioElement wired
 * into Web Audio:
 *
 *   audio element → MediaElementAudioSourceNode → GainNode → AnalyserNode → out
 *
 * The AudioContext is created on the first play (a user gesture) so autoplay
 * policies never block restoration. The gain node applies the perceptual
 * volume curve; the analyser feeds the visualizer and is only read while the
 * visualizer is mounted and visible.
 *
 * Tracks without an audio URL only exist in the browser-preview fixture; they
 * advance a silent clock so the interface stays usable without the Wails shell.
 */
export class PlayerEngine {
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private displayBins: Uint8Array<ArrayBuffer> | null = null;

  private status: EngineStatus = 'idle';
  private volume = 0.8;
  private muted = false;
  private durationSec = 0;
  private currentTrack: Track | null = null;
  private pendingSeekSec: number | null = null;
  private preview = false;
  private metadataReported = false;

  private rafId: number | null = null;
  private lastProgressAt = 0;

  private previewBaseSec = 0;
  private previewStartedAt = 0;
  private previewTimer: number | null = null;

  private destroyed = false;
  private callbacks: PlayerEngineCallbacks;

  constructor(callbacks: PlayerEngineCallbacks) {
    this.callbacks = callbacks;
    if (typeof window === 'undefined') return;

    const audio = new Audio();
    audio.preload = 'auto';
    // The media server returns Access-Control-Allow-Origin so the analyser is
    // allowed to read the stream. Must be set before the first src assignment.
    audio.crossOrigin = 'anonymous';
    audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    audio.addEventListener('durationchange', this.handleDurationChange);
    audio.addEventListener('timeupdate', this.handleTimeUpdate);
    audio.addEventListener('ended', this.handleEnded);
    audio.addEventListener('error', this.handleError);
    this.audio = audio;
  }

  public getStatus(): EngineStatus {
    return this.status;
  }

  /**
   * Loads a track. `startAtSec` is applied as soon as metadata is available;
   * `autoPlay` must only be true for a user-initiated action.
   */
  public loadTrack(track: Track, startAtSec = 0, autoPlay = false): void {
    this.stopAudio();
    this.currentTrack = track;
    this.durationSec = track.durationSec > 0 ? track.durationSec : DEFAULT_DURATION;
    this.metadataReported = false;
    const start = Number.isFinite(startAtSec) ? Math.max(0, startAtSec) : 0;
    this.pendingSeekSec = start > 0 ? start : null;

    if (track.audioUrl && this.audio) {
      this.preview = false;
      this.previewBaseSec = 0;
      const audio = this.audio;
      audio.src = track.audioUrl;
      audio.load();
      this.setStatus('loading');
      // Show the requested position immediately instead of flashing 00:00.
      this.callbacks.onProgress(start, this.durationSec);
      if (autoPlay) {
        void this.play();
      } else {
        this.setStatus('paused');
      }
      return;
    }

    // Browser-preview fixture: no file to decode, so run a silent clock.
    this.preview = true;
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.previewBaseSec = start;
    this.previewStartedAt = 0;
    this.callbacks.onProgress(start, this.durationSec);
    if (autoPlay) {
      this.startPreviewPlayback();
      this.setStatus('playing');
    } else {
      this.setStatus('paused');
    }
  }

  public async play(): Promise<void> {
    const track = this.currentTrack;
    if (!track || this.destroyed) return;
    if (this.status === 'playing') return;

    if (!track.audioUrl) {
      this.startPreviewPlayback();
      this.setStatus('playing');
      return;
    }

    const audio = this.audio;
    if (!audio) return;

    // Unlocking Web Audio must happen inside the gesture that called play().
    this.ensureAudioGraph();
    try {
      await audio.play();
      if (this.destroyed) return;
      this.setStatus('playing');
      this.startRaf();
      this.emitProgress();
    } catch (error) {
      const name = (error as DOMException | undefined)?.name;
      if (name === 'AbortError') return;
      if (name === 'NotAllowedError') {
        this.setStatus('paused');
        this.callbacks.onError?.({
          code: 'blocked',
          message: 'Playback needs a click to start. Press play to continue.',
        });
        return;
      }
      this.setStatus('error');
      this.callbacks.onError?.({
        code: name === 'NotSupportedError' ? 'unsupported' : 'unknown',
        message:
          name === 'NotSupportedError'
            ? 'This format is not supported on this platform, or the file could not be read.'
            : 'Playback could not start. The file may have moved or become unreadable.',
      });
    }
  }

  public pause(): void {
    if (this.preview && this.status === 'playing') {
      this.previewBaseSec = this.currentPosition();
    }
    this.stopAudio();
    if (this.status !== 'error') this.setStatus('paused');
    this.emitProgress();
  }

  public seek(positionSec: number): void {
    const duration = this.durationSec > 0 ? this.durationSec : positionSec;
    const target = Math.max(0, Math.min(duration, positionSec));
    if (!Number.isFinite(target)) return;

    if (this.preview || !this.audio) {
      this.previewBaseSec = target;
      this.previewStartedAt = performance.now();
      this.callbacks.onProgress(target, this.durationSec);
      return;
    }

    if (this.audio.readyState < 1) {
      this.pendingSeekSec = target;
      this.callbacks.onProgress(target, this.durationSec);
      return;
    }

    this.pendingSeekSec = null;
    try {
      this.audio.currentTime = target;
    } catch {
      this.pendingSeekSec = target;
    }
    this.callbacks.onProgress(target, this.durationSec);
  }

  public setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : this.volume;
    this.applyVolume();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /**
   * Copies analyser frequency data into `target`. Returns false while the
   * analyser is not available (before the first play or in browser preview).
   */
  public readAnalyser(target: Uint8Array): boolean {
    if (!this.analyser) return false;
    const count = this.analyser.frequencyBinCount;
    if (!this.displayBins || this.displayBins.length !== count) {
      this.displayBins = new Uint8Array(new ArrayBuffer(count));
    }
    this.analyser.getByteFrequencyData(this.displayBins);
    target.set(this.displayBins.subarray(0, Math.min(target.length, count)));
    return true;
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopAudio();
    this.stopRaf();
    if (this.audio) {
      this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
      this.audio.removeEventListener('durationchange', this.handleDurationChange);
      this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
      this.audio.removeEventListener('ended', this.handleEnded);
      this.audio.removeEventListener('error', this.handleError);
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    this.source?.disconnect();
    this.gain?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.gain = null;
    this.analyser = null;
    this.displayBins = null;
    if (this.context) {
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }

  private ensureAudioGraph(): void {
    if (typeof window === 'undefined' || !this.audio) return;
    if (this.context) {
      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => {});
      }
      return;
    }

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.applyVolume();
      return;
    }

    let context: AudioContext | null = null;
    try {
      context = new Ctor();
      const source = context.createMediaElementSource(this.audio);
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(context.destination);

      this.context = context;
      this.source = source;
      this.gain = gain;
      this.analyser = analyser;
      this.displayBins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      // The gain node now owns loudness; keep the element at unity.
      this.audio.volume = 1;
      this.applyVolume();
      void context.resume().catch(() => {});
    } catch {
      if (context) void context.close().catch(() => {});
      this.applyVolume();
    }
  }

  private applyVolume(): void {
    const level = this.muted ? 0 : Math.pow(this.volume, 2);
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(level, this.context.currentTime, 0.03);
      return;
    }
    if (this.audio) {
      this.audio.volume = level;
    }
  }

  private setStatus(status: EngineStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private currentPosition(): number {
    if (this.preview) {
      if (this.status !== 'playing') return this.previewBaseSec;
      const elapsed = (performance.now() - this.previewStartedAt) / 1000;
      return Math.min(this.durationSec, this.previewBaseSec + Math.max(0, elapsed));
    }
    return this.audio?.currentTime ?? 0;
  }

  private emitProgress(override?: number): void {
    const duration = this.durationSec > 0 ? this.durationSec : this.currentTrack?.durationSec ?? 0;
    const position = override ?? this.currentPosition();
    this.callbacks.onProgress(Math.max(0, position), duration);
  }

  private startRaf(): void {
    if (this.rafId !== null || typeof window === 'undefined') return;
    this.lastProgressAt = 0;
    const tick = (now: number) => {
      if (this.rafId === null) return;
      this.rafId = window.requestAnimationFrame(tick);
      if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
      this.lastProgressAt = now;
      this.emitProgress();
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopRaf(): void {
    if (this.rafId === null || typeof window === 'undefined') return;
    window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private startPreviewPlayback(): void {
    this.stopPreviewTimer();
    this.previewStartedAt = performance.now();
    this.previewTimer = window.setInterval(() => {
      if (this.status !== 'playing') return;
      const position = this.currentPosition();
      if (position >= this.durationSec) {
        this.previewBaseSec = this.durationSec;
        this.stopPreviewTimer();
        this.setStatus('paused');
        this.callbacks.onProgress(this.durationSec, this.durationSec);
        this.callbacks.onEnded();
        return;
      }
      this.callbacks.onProgress(position, this.durationSec);
    }, 120);
  }

  private stopPreviewTimer(): void {
    if (this.previewTimer === null || typeof window === 'undefined') return;
    window.clearInterval(this.previewTimer);
    this.previewTimer = null;
  }

  private stopAudio(): void {
    this.audio?.pause();
    this.stopRaf();
    this.stopPreviewTimer();
  }

  private reportDuration(): void {
    if (this.metadataReported) return;
    const duration = this.durationSec;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.metadataReported = true;
    this.callbacks.onMetadata?.(duration);
  }

  private handleLoadedMetadata = (): void => {
    const audio = this.audio;
    if (!audio || !this.currentTrack?.audioUrl) return;
    const parsed = audio.duration;
    if (Number.isFinite(parsed) && parsed > 0) {
      this.durationSec = parsed;
      this.reportDuration();
    }
    if (this.pendingSeekSec !== null) {
      const target = Math.max(0, Math.min(this.pendingSeekSec, Math.max(0, this.durationSec - 0.25)));
      this.pendingSeekSec = null;
      try {
        audio.currentTime = target;
      } catch {
        // Metadata race; the next seek call can still apply.
      }
    }
    this.emitProgress();
  };

  private handleDurationChange = (): void => {
    const audio = this.audio;
    if (!audio || !this.currentTrack?.audioUrl) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      this.durationSec = audio.duration;
      this.reportDuration();
    }
  };

  private handleTimeUpdate = (): void => {
    // requestAnimationFrame owns progress while the page is visible;
    // timeupdate covers paused seeks and keeps the position current when the
    // window is hidden and the browser suspends rAF.
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (this.rafId !== null && !hidden) return;
    this.emitProgress();
  };

  private handleEnded = (): void => {
    this.stopRaf();
    this.setStatus('paused');
    if (this.preview) {
      this.previewBaseSec = this.durationSec;
    }
    this.emitProgress(this.durationSec);
    this.callbacks.onEnded();
  };

  private handleError = (): void => {
    if (this.preview || !this.currentTrack?.audioUrl || !this.audio) return;
    const mediaError = this.audio.error;
    if (!mediaError) return;
    // Code 1 is an aborted load (usually a track change); never surface it.
    if (mediaError.code === 1) return;

    let code: PlaybackErrorCode = 'unknown';
    let message = 'The track could not be played.';
    if (mediaError.code === 2) {
      code = 'network';
      message = 'The audio file could not be read. Check that it still exists and the drive is connected.';
    } else if (mediaError.code === 3) {
      code = 'decode';
      message = 'This file could not be decoded. It may be damaged or use a codec this system does not support.';
    } else if (mediaError.code === 4) {
      code = 'unsupported';
      message = 'This format is not supported on this platform, or the file could not be read.';
    }
    this.stopRaf();
    this.setStatus('error');
    this.callbacks.onError?.({ code, message });
  };
}
