package library

import (
	"bytes"
	"encoding/binary"
	"os"
	"testing"
)

func writeBytes(path string, data []byte) error {
	return os.WriteFile(path, data, 0o644)
}

// writeWAV writes a valid PCM WAV with the requested amount of silence.
func writeWAV(t *testing.T, path string, seconds int) {
	t.Helper()
	const (
		sampleRate = 8000
		channels   = 1
		bits       = 16
	)
	byteRate := sampleRate * channels * bits / 8
	dataSize := byteRate * seconds
	blockAlign := channels * bits / 8

	var buf bytes.Buffer
	buf.WriteString("RIFF")
	binary.Write(&buf, binary.LittleEndian, uint32(36+dataSize))
	buf.WriteString("WAVE")
	buf.WriteString("fmt ")
	binary.Write(&buf, binary.LittleEndian, uint32(16))
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // PCM
	binary.Write(&buf, binary.LittleEndian, uint16(channels))
	binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	binary.Write(&buf, binary.LittleEndian, uint32(byteRate))
	binary.Write(&buf, binary.LittleEndian, uint16(blockAlign))
	binary.Write(&buf, binary.LittleEndian, uint16(bits))
	buf.WriteString("data")
	binary.Write(&buf, binary.LittleEndian, uint32(dataSize))
	buf.Write(make([]byte, dataSize))

	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write wav: %v", err)
	}
}

// writeFLAC writes a header-only FLAC whose STREAMINFO reports seconds.
func writeFLAC(t *testing.T, path string, seconds int) {
	t.Helper()
	const sampleRate = 44100
	totalSamples := sampleRate * seconds

	streamInfo := make([]byte, 34)
	streamInfo[10] = byte(sampleRate >> 12)
	streamInfo[11] = byte((sampleRate >> 4) & 0xff)
	streamInfo[12] = byte(sampleRate&0x0f)<<4 | 1<<1 // 2 channels
	streamInfo[13] = 14 << 4                         // 16 bits per sample
	streamInfo[13] |= byte(uint64(totalSamples)>>32) & 0x0f
	binary.BigEndian.PutUint32(streamInfo[14:18], uint32(totalSamples))

	var buf bytes.Buffer
	buf.WriteString("fLaC")
	block := make([]byte, 4)
	block[0] = 0x80 // last block, type STREAMINFO
	block[1] = 0
	block[2] = 0
	block[3] = 34
	buf.Write(block)
	buf.Write(streamInfo)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write flac: %v", err)
	}
}

// writeAIFF writes a FORM/COMM header describing seconds of audio.
func writeAIFF(t *testing.T, path string, seconds int) {
	t.Helper()
	const (
		channels = 1
		frames   = 44100
		rate     = 44100.0
	)
	comm := make([]byte, 18)
	binary.BigEndian.PutUint16(comm[0:2], channels)
	binary.BigEndian.PutUint32(comm[2:6], uint32(frames*seconds))
	binary.BigEndian.PutUint16(comm[6:8], 16)
	putExtended80(comm[8:18], rate)

	var buf bytes.Buffer
	buf.WriteString("FORM")
	binary.Write(&buf, binary.BigEndian, uint32(4+8+len(comm)))
	buf.WriteString("AIFF")
	buf.WriteString("COMM")
	binary.Write(&buf, binary.BigEndian, uint32(len(comm)))
	buf.Write(comm)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write aiff: %v", err)
	}
}

func putExtended80(b []byte, v float64) {
	exp := 16383
	for v >= 2 {
		v /= 2
		exp++
	}
	for v > 0 && v < 1 {
		v *= 2
		exp--
	}
	mantissa := uint64(v * (1 << 63))
	binary.BigEndian.PutUint16(b[0:2], uint16(exp))
	binary.BigEndian.PutUint64(b[2:10], mantissa)
}

// writeMP3 writes a single MPEG1 Layer III frame with a Xing frame count.
func writeMP3(t *testing.T, path string, frames int) {
	t.Helper()
	// MPEG1 Layer III, 128 kbps, 44.1 kHz, stereo, no padding, no CRC.
	frameLen := 144 * 128000 / 44100
	frame := make([]byte, frameLen)
	frame[0], frame[1], frame[2], frame[3] = 0xff, 0xfb, 0x90, 0x00
	copy(frame[36:40], "Xing")
	binary.BigEndian.PutUint32(frame[40:44], 0x1)
	binary.BigEndian.PutUint32(frame[44:48], uint32(frames))

	if err := os.WriteFile(path, frame, 0o644); err != nil {
		t.Fatalf("write mp3: %v", err)
	}
}

// writeM4A writes ftyp + moov/mvhd. The mvhd reports seconds at 1 kHz.
func writeM4A(t *testing.T, path string, seconds int) {
	t.Helper()
	mvhdBody := make([]byte, 20)
	mvhdBody[0] = 0 // version 0
	binary.BigEndian.PutUint32(mvhdBody[12:16], 1000)
	binary.BigEndian.PutUint32(mvhdBody[16:20], uint32(seconds*1000))
	mvhd := box("mvhd", mvhdBody)
	moov := box("moov", mvhd)
	ftyp := box("ftyp", []byte("M4A \x00\x00\x00\x00M4A mp42"))

	var buf bytes.Buffer
	buf.Write(ftyp)
	buf.Write(moov)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write m4a: %v", err)
	}
}

// writeMP3WithID3v2 prepends a small ID3v2.3 tag (title, artist, album and an
// APIC cover) to a valid MP3 frame.
func writeMP3WithID3v2(t *testing.T, path, title, artist, album string, cover []byte) {
	t.Helper()
	var frames bytes.Buffer
	frames.Write(id3v2TextFrame("TIT2", title))
	frames.Write(id3v2TextFrame("TPE1", artist))
	frames.Write(id3v2TextFrame("TALB", album))
	frames.Write(id3v2TextFrame("TPE2", artist))
	frames.Write(id3v2TextFrame("TCON", "Electronic"))
	frames.Write(id3v2TextFrame("TYER", "2004"))
	frames.Write(id3v2TextFrame("TRCK", "4"))

	apic := bytes.NewBuffer([]byte{0})
	apic.WriteString("image/png")
	apic.WriteByte(0)
	apic.WriteByte(3) // front cover
	apic.WriteByte(0) // empty description
	apic.Write(cover)
	frames.Write(id3v2Frame("APIC", apic.Bytes()))

	tagBody := frames.Bytes()
	size := len(tagBody)
	header := []byte{
		'I', 'D', '3', 3, 0, 0,
		byte(size>>21) & 0x7f,
		byte(size>>14) & 0x7f,
		byte(size>>7) & 0x7f,
		byte(size) & 0x7f,
	}

	mp3Path := path + ".frame"
	writeMP3(t, mp3Path, 40)
	audio, err := os.ReadFile(mp3Path)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(mp3Path)

	if err := os.WriteFile(path, append(append(header, tagBody...), audio...), 0o644); err != nil {
		t.Fatal(err)
	}
}

func id3v2TextFrame(id, value string) []byte {
	payload := append([]byte{3}, value...) // UTF-8
	return id3v2Frame(id, payload)
}

func id3v2Frame(id string, payload []byte) []byte {
	out := make([]byte, 10+len(payload))
	copy(out[0:4], id)
	binary.BigEndian.PutUint32(out[4:8], uint32(len(payload)))
	copy(out[10:], payload)
	return out
}

func box(kind string, body []byte) []byte {
	out := make([]byte, 8+len(body))
	binary.BigEndian.PutUint32(out[0:4], uint32(len(out)))
	copy(out[4:8], kind)
	copy(out[8:], body)
	return out
}

// writeOpusOgg writes a BOS page with OpusHead and an EOS page reporting
// seconds of granule position.
func writeOpusOgg(t *testing.T, path string, seconds int) {
	t.Helper()
	const preSkip = 312
	head := make([]byte, 19)
	copy(head, "OpusHead")
	head[8] = 1 // version
	head[9] = 2 // channels
	binary.LittleEndian.PutUint16(head[10:12], preSkip)
	binary.LittleEndian.PutUint32(head[12:16], 48000)
	// input sample rate is informational only.

	bos := oggPage(2, 0, 0, head)
	eos := oggPage(4, uint64(preSkip+48000*seconds), 1, nil)

	var buf bytes.Buffer
	buf.Write(bos)
	buf.Write(eos)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write ogg: %v", err)
	}
}

func oggPage(headerType byte, granule uint64, seq uint32, payload []byte) []byte {
	out := make([]byte, 27+1+len(payload))
	copy(out[0:4], "OggS")
	out[4] = 0
	out[5] = headerType
	binary.LittleEndian.PutUint64(out[6:14], granule)
	binary.LittleEndian.PutUint32(out[14:18], 1)
	binary.LittleEndian.PutUint32(out[18:22], seq)
	out[26] = 1
	out[27] = byte(len(payload))
	copy(out[28:], payload)
	return out
}

// writeADTS writes count AAC-LC frames at 44.1 kHz stereo.
func writeADTS(t *testing.T, path string, frames int) {
	t.Helper()
	const frameLen = 100
	frame := make([]byte, frameLen)
	frame[0] = 0xff
	frame[1] = 0xf1
	frame[2] = 1<<6 | 4<<2 // AAC LC, 44.1 kHz
	frame[3] = 2<<6 | byte(frameLen>>11)
	frame[4] = byte(frameLen >> 3)
	frame[5] = byte(frameLen&0x7)<<5 | 0x1f
	frame[6] = 0xfc

	var buf bytes.Buffer
	for i := 0; i < frames; i++ {
		buf.Write(frame)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("write adts: %v", err)
	}
}
