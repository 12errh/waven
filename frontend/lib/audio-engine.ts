'use client';

import type { SynthProfile, Track } from './types';

export interface AudioCallbacks {
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onEnded: () => void;
  /** Fired when the browser reports a duration the library did not know. */
  onMetadata?: (durationSec: number) => void;
  onError?: (message: string) => void;
}

const DEFAULT_SYNTH: SynthProfile = {
  bpm: 116,
  rootHz: 220,
  chords: [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [130.81, 164.81, 196.0],
    [196.0, 246.94, 293.66],
  ],
  padColor: 'warm',
};

/**
 * Plays real files from the loopback media server through an HTML5 <audio>
 * element. Tracks without an audio URL (the browser-preview fixture) fall back
 * to a quiet Web Audio pad so the interface still has motion and sound.
 */
export class WavenAudioEngine {
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private mode: 'html5' | 'synth' = 'synth';
  private isPlaying = false;
  private volume = 0.75;
  private muted = false;

  private currentTrack: Track | null = null;
  private elapsedSec = 0;
  private durationSec = 192;

  private tickerId: number | null = null;
  private lastTickMs = 0;
  private stepCount = 0;
  private nextStepTime = 0;

  private callbacks: AudioCallbacks;

  constructor(callbacks: AudioCallbacks) {
    this.callbacks = callbacks;
    if (typeof window !== 'undefined') {
      this.audioEl = new Audio();
      this.audioEl.preload = 'auto';
      this.audioEl.crossOrigin = 'anonymous';

      this.audioEl.addEventListener('timeupdate', () => {
        if (this.mode !== 'html5' || !this.audioEl) return;
        const dur =
          Number.isFinite(this.audioEl.duration) && this.audioEl.duration > 0
            ? this.audioEl.duration
            : this.durationSec;
        this.elapsedSec = this.audioEl.currentTime;
        this.durationSec = dur;
        this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);
      });

      this.audioEl.addEventListener('loadedmetadata', () => {
        if (this.mode !== 'html5' || !this.audioEl) return;
        const dur = this.audioEl.duration;
        if (Number.isFinite(dur) && dur > 0) {
          this.durationSec = dur;
          this.callbacks.onMetadata?.(dur);
          this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);
        }
      });

      this.audioEl.addEventListener('ended', () => {
        if (this.mode !== 'html5') return;
        this.isPlaying = false;
        this.callbacks.onEnded();
      });

      this.audioEl.addEventListener('error', () => {
        if (this.mode !== 'html5') return;
        this.isPlaying = false;
        this.callbacks.onError?.(
          this.currentTrack?.audioUrl
            ? `Could not play "${this.currentTrack.title}". The file may have moved or use a codec this system does not support.`
            : 'Could not play this track.'
        );
      });
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.audioCtx = new Ctx();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume * 0.25;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public loadTrack(track: Track, startAtSec = 0, autoPlay = false) {
    this.stopSynthLoop();
    this.currentTrack = track;
    this.elapsedSec = Math.max(0, startAtSec);
    this.durationSec = track.durationSec > 0 ? track.durationSec : 192;

    if (this.audioEl) {
      this.audioEl.pause();
      if (track.audioUrl) {
        this.mode = 'html5';
        this.audioEl.src = track.audioUrl;
        this.audioEl.volume = this.muted ? 0 : this.volume;
        if (startAtSec > 0) {
          try {
            this.audioEl.currentTime = startAtSec;
          } catch {
            // The seek applies once metadata is available.
          }
        }
      } else {
        this.mode = 'synth';
        this.audioEl.removeAttribute('src');
        this.audioEl.load();
      }
    } else {
      this.mode = 'synth';
    }

    this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);

    if (autoPlay) {
      void this.play();
    } else {
      this.isPlaying = false;
    }
  }

  public async play() {
    if (!this.currentTrack) return;
    this.isPlaying = true;

    if (this.mode === 'html5' && this.audioEl && this.currentTrack.audioUrl) {
      try {
        this.audioEl.volume = this.muted ? 0 : this.volume;
        await this.audioEl.play();
        return;
      } catch (error) {
        this.isPlaying = false;
        const name = (error as DOMException)?.name;
        if (name === 'NotAllowedError') {
          this.callbacks.onError?.('Playback needs a click to start. Press play to continue.');
        } else if (name !== 'AbortError') {
          this.callbacks.onError?.(
            'Could not play this track. The file may have moved or use a codec this system does not support.'
          );
        }
        return;
      }
    }

    this.startSynthLoop();
  }

  public pause() {
    this.isPlaying = false;
    if (this.audioEl && this.mode === 'html5') {
      this.audioEl.pause();
    }
    this.stopSynthLoop();
  }

  public seek(sec: number) {
    const clamped = Math.max(0, Math.min(this.durationSec, sec));
    this.elapsedSec = clamped;
    if (this.mode === 'html5' && this.audioEl) {
      try {
        this.audioEl.currentTime = clamped;
      } catch {
        // ignore until metadata is available
      }
    }
    this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audioEl) {
      this.audioEl.volume = this.muted ? 0 : this.volume;
    }
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume * 0.25,
        this.audioCtx.currentTime,
        0.04
      );
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    this.setVolume(this.volume);
  }

  private startSynthLoop() {
    this.stopSynthLoop();
    const ctx = this.ensureAudioContext();
    this.lastTickMs = performance.now();
    this.nextStepTime = ctx ? ctx.currentTime + 0.05 : 0;

    this.tickerId = window.setInterval(() => {
      if (!this.isPlaying) return;
      const now = performance.now();
      const dt = Math.min(0.5, (now - this.lastTickMs) / 1000);
      this.lastTickMs = now;

      this.elapsedSec += dt;
      if (this.elapsedSec >= this.durationSec) {
        this.elapsedSec = this.durationSec;
        this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);
        this.isPlaying = false;
        this.stopSynthLoop();
        this.callbacks.onEnded();
        return;
      }

      this.callbacks.onTimeUpdate(this.elapsedSec, this.durationSec);

      if (ctx && this.masterGain && !this.muted && this.volume > 0.01) {
        const profile = this.currentTrack?.synth ?? DEFAULT_SYNTH;
        const stepDur = 60 / profile.bpm / 2;
        while (this.nextStepTime < ctx.currentTime + 0.15) {
          this.triggerSynthStep(ctx, this.masterGain, profile, this.stepCount, this.nextStepTime);
          this.nextStepTime += stepDur;
          this.stepCount += 1;
        }
      }
    }, 100);
  }

  private triggerSynthStep(
    ctx: AudioContext,
    dest: GainNode,
    profile: SynthProfile,
    step: number,
    time: number
  ) {
    const barStep = step % 8;
    const chordIdx = Math.floor(step / 8) % profile.chords.length;
    const chord = profile.chords[chordIdx] ?? DEFAULT_SYNTH.chords[0];

    if (barStep === 0) {
      for (const freq of chord) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        osc.type = profile.padColor === 'bright' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, time);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(profile.padColor === 'nocturnal' ? 750 : 1200, time);

        gain.gain.setValueAtTime(0.001, time);
        gain.gain.linearRampToValueAtTime(0.12, time + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 1.6);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(dest);
        osc.start(time);
        osc.stop(time + 1.65);
      }
    }

    if (barStep % 2 === 0) {
      const noteFreq = chord[(barStep / 2) % chord.length] * 2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(noteFreq, time);
      gain.gain.setValueAtTime(0.001, time);
      gain.gain.linearRampToValueAtTime(0.07, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(time);
      osc.stop(time + 0.38);
    }
  }

  private stopSynthLoop() {
    if (this.tickerId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.tickerId);
      this.tickerId = null;
    }
  }

  public destroy() {
    this.pause();
    if (this.audioEl) {
      this.audioEl.removeAttribute('src');
      this.audioEl.load();
      this.audioEl = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
