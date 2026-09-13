import {
  decodeMuLawToPcm16,
  encodePcm16ToMuLaw,
  pcm16ToMuLawSample,
  createWavHeader,
  wrapPcmInWav,
  calculateRmsEnergy,
} from './audio-codec.util.js';

describe('AudioCodecUtil', () => {
  describe('G.711 Mu-law <-> Linear PCM16 conversion', () => {
    it('1. should convert pcm sample to mu-law and decode back within quantization limits', () => {
      const testValues = [0, 100, 1000, 5000, 20000, -500, -15000];
      for (const val of testValues) {
        const mu = pcm16ToMuLawSample(val);
        expect(mu).toBeGreaterThanOrEqual(0);
        expect(mu).toBeLessThanOrEqual(255);

        const buf = Buffer.from([mu]);
        const decoded = decodeMuLawToPcm16(buf);
        const decodedVal = decoded.readInt16LE(0);

        // G.711 mu-law is logarithmic 8-bit, relative error is within expected bounds
        const diff = Math.abs(val - decodedVal);
        if (Math.abs(val) < 100) {
          expect(diff).toBeLessThan(10);
        } else {
          expect(diff / Math.abs(val)).toBeLessThan(0.05); // <5% error
        }
      }
    });

    it('2. should handle empty buffers gracefully', () => {
      expect(decodeMuLawToPcm16(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
      expect(encodePcm16ToMuLaw(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
      expect(wrapPcmInWav(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
      expect(calculateRmsEnergy(Buffer.alloc(0))).toBe(0);
    });

    it('3. should decode 160-byte mu-law frame (20ms) into 320-byte PCM16 frame', () => {
      const muFrame = Buffer.alloc(160, 0xff); // 0xff is silence in mu-law
      const pcm = decodeMuLawToPcm16(muFrame);
      expect(pcm.length).toBe(320);

      // Verify all samples decode to 0 (silence)
      for (let i = 0; i < 160; i++) {
        expect(pcm.readInt16LE(i * 2)).toBe(0);
      }
    });

    it('4. should encode PCM16 buffer into mu-law buffer of half size', () => {
      const pcm = Buffer.alloc(320);
      for (let i = 0; i < 160; i++) {
        pcm.writeInt16LE(1000, i * 2);
      }
      const mu = encodePcm16ToMuLaw(pcm);
      expect(mu.length).toBe(160);
    });
  });

  describe('WAV Container Packaging', () => {
    it('5. should create valid 44-byte RIFF/WAVE header for 8000Hz 16-bit Mono PCM', () => {
      const pcmLength = 3200; // 200ms of audio
      const header = createWavHeader(pcmLength, 8000, 1, 16);

      expect(header.length).toBe(44);
      expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(header.readUInt32LE(4)).toBe(36 + pcmLength);
      expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE');
      expect(header.subarray(12, 16).toString('ascii')).toBe('fmt ');
      expect(header.readUInt32LE(16)).toBe(16); // PCM subchunk size
      expect(header.readUInt16LE(20)).toBe(1); // Linear PCM format
      expect(header.readUInt16LE(22)).toBe(1); // Channels = 1 (Mono)
      expect(header.readUInt32LE(24)).toBe(8000); // Sample rate = 8000 Hz
      expect(header.readUInt32LE(28)).toBe(16000); // Byte rate = 8000 * 1 * 2
      expect(header.readUInt16LE(32)).toBe(2); // Block align
      expect(header.readUInt16LE(34)).toBe(16); // Bits per sample
      expect(header.subarray(36, 40).toString('ascii')).toBe('data');
      expect(header.readUInt32LE(40)).toBe(pcmLength);
    });

    it('6. should wrap PCM buffer in full WAV container', () => {
      const pcm = Buffer.alloc(640, 12);
      const wav = wrapPcmInWav(pcm, 8000);

      expect(wav.length).toBe(44 + 640);
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(wav.subarray(44)).toEqual(pcm);
    });
  });

  describe('RMS Energy & Voice Activity Detection', () => {
    it('7. should calculate 0 energy for silence and positive energy for speech', () => {
      const silence = Buffer.alloc(320, 0);
      expect(calculateRmsEnergy(silence)).toBe(0);

      const speech = Buffer.alloc(320);
      for (let i = 0; i < 160; i++) {
        speech.writeInt16LE(2000, i * 2);
      }
      expect(calculateRmsEnergy(speech)).toBe(2000);
    });
  });
});
