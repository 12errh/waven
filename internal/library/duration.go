package library

import (
	"encoding/binary"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// DurationMs reads the duration from a container header. It never decodes
// audio. A parse failure returns 0 so the scanner can still import the file;
// the webview will report the real duration once it loads the track.
func DurationMs(path string) int64 {
	ext := strings.ToLower(filepath.Ext(path))
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()

	var ms int64
	switch ext {
	case ".flac":
		ms = flacDuration(f)
	case ".wav":
		ms = wavDuration(f)
	case ".aiff", ".aif":
		ms = aiffDuration(f)
	case ".mp3":
		ms = mp3Duration(f)
	case ".m4a":
		ms = m4aDuration(f)
	case ".ogg", ".oga", ".opus":
		ms = oggDuration(f)
	case ".aac":
		ms = adtsDuration(f)
	}
	if ms < 0 {
		return 0
	}
	return ms
}

func flacDuration(f *os.File) int64 {
	header := make([]byte, 4)
	if _, err := io.ReadFull(f, header); err != nil || string(header) != "fLaC" {
		return 0
	}
	for {
		blockHeader := make([]byte, 4)
		if _, err := io.ReadFull(f, blockHeader); err != nil {
			return 0
		}
		last := blockHeader[0]&0x80 != 0
		blockType := blockHeader[0] & 0x7f
		length := int64(blockHeader[1])<<16 | int64(blockHeader[2])<<8 | int64(blockHeader[3])
		if blockType == 0 {
			if length < 34 {
				return 0
			}
			body := make([]byte, 34)
			if _, err := io.ReadFull(f, body); err != nil {
				return 0
			}
			sampleRate := int64(body[10])<<12 | int64(body[11])<<4 | int64(body[12])>>4
			totalSamples := int64(body[13]&0x0f)<<32 |
				int64(body[14])<<24 | int64(body[15])<<16 |
				int64(body[16])<<8 | int64(body[17])
			if sampleRate <= 0 || totalSamples <= 0 {
				return 0
			}
			return totalSamples * 1000 / sampleRate
		}
		if _, err := f.Seek(length, io.SeekCurrent); err != nil {
			return 0
		}
		if last {
			return 0
		}
	}
}

func wavDuration(f *os.File) int64 {
	header := make([]byte, 12)
	if _, err := io.ReadFull(f, header); err != nil {
		return 0
	}
	if string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return 0
	}

	var byteRate uint32
	var dataSize uint32
	offset := int64(12)
	stat, err := f.Stat()
	if err != nil {
		return 0
	}
	fileSize := stat.Size()

	for offset+8 <= fileSize {
		chunk := make([]byte, 8)
		if _, err := f.ReadAt(chunk, offset); err != nil {
			return 0
		}
		id := string(chunk[0:4])
		size := binary.LittleEndian.Uint32(chunk[4:8])
		body := offset + 8
		switch id {
		case "fmt ":
			fmtBody := make([]byte, min(int64(size), 16))
			if _, err := f.ReadAt(fmtBody, body); err != nil {
				return 0
			}
			if len(fmtBody) >= 12 {
				byteRate = binary.LittleEndian.Uint32(fmtBody[8:12])
			}
		case "data":
			dataSize = size
			if dataSize == 0 || dataSize == math.MaxUint32 {
				dataSize = uint32(max(0, fileSize-body))
			}
		}
		next := body + int64(size)
		if size%2 == 1 {
			next++
		}
		if next <= offset {
			break
		}
		offset = next
	}

	if byteRate == 0 || dataSize == 0 {
		return 0
	}
	return int64(dataSize) * 1000 / int64(byteRate)
}

func aiffDuration(f *os.File) int64 {
	header := make([]byte, 12)
	if _, err := io.ReadFull(f, header); err != nil {
		return 0
	}
	if string(header[0:4]) != "FORM" {
		return 0
	}
	kind := string(header[8:12])
	if kind != "AIFF" && kind != "AIFC" {
		return 0
	}

	stat, err := f.Stat()
	if err != nil {
		return 0
	}
	offset := int64(12)
	for offset+8 <= stat.Size() {
		chunk := make([]byte, 8)
		if _, err := f.ReadAt(chunk, offset); err != nil {
			return 0
		}
		size := int64(binary.BigEndian.Uint32(chunk[4:8]))
		body := offset + 8
		if string(chunk[0:4]) == "COMM" && size >= 18 {
			comm := make([]byte, 18)
			if _, err := f.ReadAt(comm, body); err != nil {
				return 0
			}
			frames := int64(binary.BigEndian.Uint32(comm[2:6]))
			rate := extended80(comm[8:18])
			if frames <= 0 || rate <= 0 {
				return 0
			}
			return int64(float64(frames) / rate * 1000)
		}
		next := body + size
		if size%2 == 1 {
			next++
		}
		if next <= offset {
			break
		}
		offset = next
	}
	return 0
}

// extended80 converts an 80-bit IEEE 754 extended-precision float.
func extended80(b []byte) float64 {
	exp := int(binary.BigEndian.Uint16(b[0:2]) & 0x7fff)
	mantissa := binary.BigEndian.Uint64(b[2:10])
	if exp == 0 && mantissa == 0 {
		return 0
	}
	v := float64(mantissa) * math.Pow(2, float64(exp)-16383-63)
	if b[0]&0x80 != 0 {
		return -v
	}
	return v
}

var mp3Bitrates = [2][3][16]int{
	// MPEG1: Layer I, II, III
	{
		{0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0},
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0},
		{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0},
	},
	// MPEG2/2.5: Layer I, II, III
	{
		{0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
		{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0},
	},
}

var mp3SampleRates = [4][3]int{
	{11025, 12000, 8000},  // MPEG2.5
	{0, 0, 0},             // reserved
	{22050, 24000, 16000}, // MPEG2
	{44100, 48000, 32000}, // MPEG1
}

type mp3Frame struct {
	offset      int64
	version     int // 1, 2, or 25
	layer       int // 1, 2, or 3
	bitrate     int
	sampleRate  int
	padding     int
	protected   int
	mono        bool
	frameLength int
	samples     int
}

func mp3Duration(f *os.File) int64 {
	stat, err := f.Stat()
	if err != nil {
		return 0
	}
	audioOffset := int64(0)
	id3 := make([]byte, 10)
	if _, err := f.ReadAt(id3, 0); err == nil && string(id3[0:3]) == "ID3" {
		size := int64(id3[6]&0x7f)<<21 | int64(id3[7]&0x7f)<<14 | int64(id3[8]&0x7f)<<7 | int64(id3[9]&0x7f)
		audioOffset = 10 + size
		if id3[5]&0x10 != 0 {
			audioOffset += 10
		}
	}
	if audioOffset >= stat.Size() {
		return 0
	}

	const searchSize = 512 * 1024
	searchLen := min(searchSize, stat.Size()-audioOffset)
	buf := make([]byte, searchLen)
	if _, err := f.ReadAt(buf, audioOffset); err != nil && !errors.Is(err, io.EOF) {
		return 0
	}

	frame, ok := findMP3Frame(buf)
	if !ok {
		return 0
	}
	frame.offset += audioOffset
	frameLen := int64(frame.frameLength)
	if frameLen <= 0 {
		return 0
	}

	// Xing/Info lives after the frame header, CRC, and side information.
	xingOffset := int64(4)
	if frame.protected == 0 {
		xingOffset += 2
	}
	if frame.version == 1 {
		if frame.mono {
			xingOffset += 17
		} else {
			xingOffset += 32
		}
	} else {
		if frame.mono {
			xingOffset += 9
		} else {
			xingOffset += 17
		}
	}
	tag := make([]byte, 12)
	if _, err := f.ReadAt(tag, frame.offset+xingOffset); err == nil {
		if string(tag[0:4]) == "Xing" || string(tag[0:4]) == "Info" {
			flags := binary.BigEndian.Uint32(tag[4:8])
			if flags&0x1 != 0 {
				frames := int64(binary.BigEndian.Uint32(tag[8:12]))
				if frames > 0 && frame.sampleRate > 0 {
					return frames * int64(frame.samples) * 1000 / int64(frame.sampleRate)
				}
			}
		}
	}

	audioBytes := stat.Size() - frame.offset
	if audioBytes > 128 {
		tail := make([]byte, 3)
		if _, err := f.ReadAt(tail, stat.Size()-128); err == nil && string(tail) == "TAG" {
			audioBytes -= 128
		}
	}
	if frame.bitrate <= 0 {
		return 0
	}
	return audioBytes * 8 / int64(frame.bitrate)
}

func findMP3Frame(buf []byte) (mp3Frame, bool) {
	for i := 0; i+4 <= len(buf); i++ {
		if buf[i] != 0xff || buf[i+1]&0xe0 != 0xe0 {
			continue
		}
		frame, ok := parseMP3Header(buf[i : i+4])
		if !ok {
			continue
		}
		frame.offset = int64(i)
		return frame, true
	}
	return mp3Frame{}, false
}

func parseMP3Header(h []byte) (mp3Frame, bool) {
	if len(h) < 4 || h[0] != 0xff || h[1]&0xe0 != 0xe0 {
		return mp3Frame{}, false
	}
	versionBits := (h[1] >> 3) & 0x3
	layerBits := (h[1] >> 1) & 0x3
	if versionBits == 1 || layerBits == 0 {
		return mp3Frame{}, false
	}
	bitrateIndex := int(h[2] >> 4)
	sampleIndex := int((h[2] >> 2) & 0x3)
	if bitrateIndex == 0 || bitrateIndex == 15 || sampleIndex == 3 {
		return mp3Frame{}, false
	}

	frame := mp3Frame{
		padding:   int((h[2] >> 1) & 0x1),
		protected: int(h[1] & 0x1),
		mono:      (h[3]>>6)&0x3 == 3,
	}

	switch versionBits {
	case 0:
		frame.version = 25
	case 2:
		frame.version = 2
	case 3:
		frame.version = 1
	}
	switch layerBits {
	case 1:
		frame.layer = 3
	case 2:
		frame.layer = 2
	case 3:
		frame.layer = 1
	}

	tableVersion := 0
	if frame.version != 1 {
		tableVersion = 1
	}
	tableLayer := 3 - frame.layer // Layer I -> 0
	frame.bitrate = mp3Bitrates[tableVersion][tableLayer][bitrateIndex]
	rateRow := 0
	switch frame.version {
	case 25:
		rateRow = 0
	case 2:
		rateRow = 2
	case 1:
		rateRow = 3
	}
	frame.sampleRate = mp3SampleRates[rateRow][sampleIndex]
	if frame.bitrate == 0 || frame.sampleRate == 0 {
		return mp3Frame{}, false
	}

	switch frame.layer {
	case 1:
		frame.samples = 384
		frame.frameLength = (12*frame.bitrate*1000/frame.sampleRate + frame.padding) * 4
	case 2:
		frame.samples = 1152
		frame.frameLength = 144*frame.bitrate*1000/frame.sampleRate + frame.padding
	case 3:
		if frame.version == 1 {
			frame.samples = 1152
			frame.frameLength = 144*frame.bitrate*1000/frame.sampleRate + frame.padding
		} else {
			frame.samples = 576
			frame.frameLength = 72*frame.bitrate*1000/frame.sampleRate + frame.padding
		}
	}
	return frame, frame.frameLength > 4
}

func m4aDuration(f *os.File) int64 {
	stat, err := f.Stat()
	if err != nil {
		return 0
	}
	body, err := findBox(f, 0, stat.Size(), "moov", "mvhd")
	if err != nil || len(body) < 20 {
		return 0
	}
	version := body[0]
	var timescale uint32
	var duration uint64
	if version == 1 {
		if len(body) < 32 {
			return 0
		}
		timescale = binary.BigEndian.Uint32(body[20:24])
		duration = binary.BigEndian.Uint64(body[24:32])
	} else {
		timescale = binary.BigEndian.Uint32(body[12:16])
		duration = uint64(binary.BigEndian.Uint32(body[16:20]))
	}
	if timescale == 0 || duration == 0 {
		return 0
	}
	return int64(duration) * 1000 / int64(timescale)
}

// findBox searches nested ISO BMFF boxes for a path of types.
func findBox(f *os.File, start, end int64, path ...string) ([]byte, error) {
	if len(path) == 0 {
		return nil, errors.New("empty box path")
	}
	offset := start
	for offset+8 <= end {
		header := make([]byte, 8)
		if _, err := f.ReadAt(header, offset); err != nil {
			return nil, err
		}
		size := int64(binary.BigEndian.Uint32(header[0:4]))
		boxType := string(header[4:8])
		headerSize := int64(8)
		if size == 1 {
			large := make([]byte, 8)
			if _, err := f.ReadAt(large, offset+8); err != nil {
				return nil, err
			}
			size = int64(binary.BigEndian.Uint64(large))
			headerSize = 16
		} else if size == 0 {
			size = end - offset
		}
		if size < headerSize || offset+size > end {
			return nil, errors.New("invalid box size")
		}
		bodyStart := offset + headerSize
		if boxType == path[0] {
			if len(path) == 1 {
				body := make([]byte, size-headerSize)
				_, err := f.ReadAt(body, bodyStart)
				return body, err
			}
			return findBox(f, bodyStart, offset+size, path[1:]...)
		}
		offset += size
	}
	return nil, errors.New("box not found")
}

func oggDuration(f *os.File) int64 {
	stat, err := f.Stat()
	if err != nil || stat.Size() < 28 {
		return 0
	}
	head := make([]byte, min(int64(64*1024), stat.Size()))
	if _, err := f.ReadAt(head, 0); err != nil && !errors.Is(err, io.EOF) {
		return 0
	}
	codec, sampleRate, preSkip := oggCodecInfo(head)
	if sampleRate <= 0 {
		return 0
	}

	tailLen := min(int64(256*1024), stat.Size())
	tail := make([]byte, tailLen)
	tailStart := stat.Size() - tailLen
	if _, err := f.ReadAt(tail, tailStart); err != nil && !errors.Is(err, io.EOF) {
		return 0
	}
	for i := len(tail) - 27; i >= 0; i-- {
		if string(tail[i:i+4]) != "OggS" || tail[i+4] != 0 {
			continue
		}
		granule := int64(binary.LittleEndian.Uint64(tail[i+6 : i+14]))
		if granule <= 0 {
			continue
		}
		if codec == "opus" {
			granule -= int64(preSkip)
			sampleRate = 48000
		}
		if granule <= 0 {
			continue
		}
		return granule * 1000 / int64(sampleRate)
	}
	return 0
}

func oggCodecInfo(page []byte) (codec string, sampleRate int, preSkip int) {
	if len(page) < 28 || string(page[0:4]) != "OggS" {
		return "", 0, 0
	}
	segments := int(page[26])
	payload := 27 + segments
	if payload >= len(page) {
		return "", 0, 0
	}
	packet := page[payload:]
	if len(packet) >= 19 && string(packet[0:8]) == "OpusHead" {
		pre := int(binary.LittleEndian.Uint16(packet[10:12]))
		return "opus", 48000, pre
	}
	if len(packet) >= 16 && packet[0] == 1 && string(packet[1:7]) == "vorbis" {
		rate := int(binary.LittleEndian.Uint32(packet[12:16]))
		return "vorbis", rate, 0
	}
	return "", 0, 0
}

func adtsDuration(f *os.File) int64 {
	offset := int64(0)
	id3 := make([]byte, 10)
	if _, err := f.ReadAt(id3, 0); err == nil && string(id3[0:3]) == "ID3" {
		size := int64(id3[6]&0x7f)<<21 | int64(id3[7]&0x7f)<<14 | int64(id3[8]&0x7f)<<7 | int64(id3[9]&0x7f)
		offset = 10 + size
	}
	stat, err := f.Stat()
	if err != nil {
		return 0
	}

	rates := [...]int{96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350}
	var sampleRate int
	var frames int64
	header := make([]byte, 7)
	for offset+7 <= stat.Size() {
		if _, err := f.ReadAt(header, offset); err != nil {
			return 0
		}
		if header[0] != 0xff || header[1]&0xf6 != 0xf0 {
			offset++
			continue
		}
		rateIndex := int((header[2] >> 2) & 0xf)
		if rateIndex >= len(rates) {
			return 0
		}
		if sampleRate == 0 {
			sampleRate = rates[rateIndex]
		}
		frameLen := int(header[3]&0x3)<<11 | int(header[4])<<3 | int(header[5]>>5)
		if frameLen < 7 {
			return 0
		}
		frames++
		offset += int64(frameLen)
	}
	if sampleRate == 0 || frames == 0 {
		return 0
	}
	return frames * 1024 * 1000 / int64(sampleRate)
}
