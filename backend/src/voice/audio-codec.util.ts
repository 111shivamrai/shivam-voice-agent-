/**
 * Audio Codec Utilities for Telnyx Real-Time Media Streaming & Sarvam AI.
 *
 * Implements:
 * 1. ITU-T G.711 Mu-law to Linear 16-bit PCM decoding (O(1) precomputed lookup table)
 * 2. Linear 16-bit PCM to ITU-T G.711 Mu-law encoding
 * 3. Standard 44-byte RIFF/WAVE header packaging (8000Hz, 16-bit Linear PCM Mono)
 * 4. Root-Mean-Square (RMS) audio energy estimation for Voice Activity Detection (VAD)
 */

// Precomputed 256-entry ITU-T G.711 mu-law to 16-bit signed Linear PCM lookup table
const MULAW_TO_PCM16 = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const byte = ~i & 0xff;
  const isPositive = (byte & 0x80) !== 0;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_TO_PCM16[i] = isPositive ? sample : -sample;
}

/**
 * Converts a single 16-bit Linear PCM sample into 8-bit ITU-T G.711 mu-law byte.
 */
export function pcm16ToMuLawSample(pcm: number): number {
  let sample = pcm;
  const isNegative = sample < 0;
  if (isNegative) sample = -sample;
  if (sample > 32635) sample = 32635;
  sample += 0x84;

  let exponent = 7;
  for (let exp = 0; exp < 7; exp++) {
    if (sample < (0x100 << exp)) {
      exponent = exp;
      break;
    }
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const signBit = isNegative ? 0 : 0x80;
  return ~(signBit | (exponent << 4) | mantissa) & 0xff;
}

/**
 * Decodes G.711 mu-law buffer into 16-bit Linear PCM buffer (Little-Endian).
 */
export function decodeMuLawToPcm16(muLawBuffer: Buffer): Buffer {
  if (!muLawBuffer || muLawBuffer.length === 0) {
    return Buffer.alloc(0);
  }

  const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
  for (let i = 0; i < muLawBuffer.length; i++) {
    const muVal = muLawBuffer[i];
    const pcmSample = MULAW_TO_PCM16[muVal];
    pcmBuffer.writeInt16LE(pcmSample, i * 2);
  }

  return pcmBuffer;
}

/**
 * Encodes 16-bit Linear PCM buffer (Little-Endian) into G.711 mu-law buffer.
 */
export function encodePcm16ToMuLaw(pcm16Buffer: Buffer): Buffer {
  if (!pcm16Buffer || pcm16Buffer.length === 0) {
    return Buffer.alloc(0);
  }

  const sampleCount = Math.floor(pcm16Buffer.length / 2);
  const muLawBuffer = Buffer.alloc(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const pcmSample = pcm16Buffer.readInt16LE(i * 2);
    muLawBuffer[i] = pcm16ToMuLawSample(pcmSample);
  }

  return muLawBuffer;
}

/**
 * Generates a standard 44-byte RIFF/WAVE header for linear PCM audio data.
 */
export function createWavHeader(
  dataLength: number,
  sampleRate = 8000,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

/**
 * Wraps 16-bit Linear PCM audio buffer into a complete, standard WAV buffer compatible with Sarvam STT.
 */
export function wrapPcmInWav(pcm16Buffer: Buffer, sampleRate = 8000): Buffer {
  if (!pcm16Buffer || pcm16Buffer.length === 0) {
    return Buffer.alloc(0);
  }
  const header = createWavHeader(pcm16Buffer.length, sampleRate, 1, 16);
  return Buffer.concat([header, pcm16Buffer]);
}

/**
 * Computes Root-Mean-Square (RMS) amplitude from 16-bit Linear PCM audio buffer.
 * Used for fast server-side Voice Activity Detection (VAD).
 */
export function calculateRmsEnergy(pcm16Buffer: Buffer): number {
  if (!pcm16Buffer || pcm16Buffer.length < 2) {
    return 0;
  }

  const sampleCount = Math.floor(pcm16Buffer.length / 2);
  let sumSquares = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm16Buffer.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / sampleCount);
}
