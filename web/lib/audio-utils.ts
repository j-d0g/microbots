/**
 * Audio Utilities
 *
 * Helper functions for audio format conversion, encoding/decoding,
 * and Web Audio API operations for the voice pipeline.
 */

/**
 * Convert a Blob to base64 string
 * Used for sending audio chunks over WebSocket
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert base64 string to ArrayBuffer
 * Used for decoding audio data for playback
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decode audio data using Web Audio API
 * Handles various formats including PCM and μ-law
 */
export async function decodeAudioData(
  ctx: AudioContext,
  buffer: ArrayBuffer
): Promise<AudioBuffer> {
  try {
    // Try standard Web Audio API decode first
    return await ctx.decodeAudioData(buffer);
  } catch (err) {
    // If standard decode fails, try to handle raw PCM
    console.warn('[audio-utils] Standard decode failed, trying PCM decode:', err);
    return decodePCMAudioData(ctx, buffer);
  }
}

/**
 * Decode raw PCM audio data (16-bit signed, mono, 16kHz or 24kHz)
 * ElevenLabs typically returns PCM audio at 16kHz or 24kHz
 */
async function decodePCMAudioData(
  ctx: AudioContext,
  buffer: ArrayBuffer,
  sampleRate: number = 16000
): Promise<AudioBuffer> {
  // Check if buffer size suggests PCM format
  // PCM 16-bit mono: 2 bytes per sample
  const numSamples = buffer.byteLength / 2;

  if (numSamples !== Math.floor(numSamples)) {
    throw new Error(`[audio-utils] Invalid PCM buffer size: ${buffer.byteLength}`);
  }

  // Create audio buffer at the target sample rate
  const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  // Read 16-bit signed PCM data
  const dataView = new DataView(buffer);
  for (let i = 0; i < numSamples; i++) {
    // Convert 16-bit signed integer to float (-1.0 to 1.0)
    const sample = dataView.getInt16(i * 2, true); // little-endian
    channelData[i] = sample / 32768.0;
  }

  return audioBuffer;
}

/**
 * Decode μ-law encoded audio to PCM
 * Some telephony systems use μ-law encoding
 */
export function decodeMulawToPCM(mulawBuffer: Uint8Array): Int16Array {
  const MULAW_BIAS = 33;
  const pcmData = new Int16Array(mulawBuffer.length);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const mulaw = ~mulawBuffer[i]; // Invert bits
    const sign = (mulaw & 0x80) ? -1 : 1;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;

    let pcm = ((mantissa << 1) + 33) << exponent;
    pcm -= MULAW_BIAS;
    pcm *= sign;

    pcmData[i] = pcm;
  }

  return pcmData;
}

/**
 * Convert PCM Int16Array to AudioBuffer
 */
export function pcmToAudioBuffer(
  ctx: AudioContext,
  pcmData: Int16Array,
  sampleRate: number = 16000
): AudioBuffer {
  const audioBuffer = ctx.createBuffer(1, pcmData.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < pcmData.length; i++) {
    channelData[i] = pcmData[i] / 32768.0;
  }

  return audioBuffer;
}

/**
 * Create a media stream from an AudioBuffer for recording
 * Useful for creating a MediaRecorder-compatible stream
 */
export function createMediaStreamFromAudioBuffer(
  ctx: AudioContext,
  audioBuffer: AudioBuffer
): MediaStream {
  const dest = ctx.createMediaStreamDestination();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(dest);
  source.start();
  return dest.stream;
}

/**
 * Resample audio buffer to a different sample rate
 */
export async function resampleAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * targetSampleRate),
    targetSampleRate
  );

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start();

  return ctx.startRendering();
}

/**
 * Concatenate multiple AudioBuffers into one
 */
export function concatenateAudioBuffers(
  ctx: AudioContext,
  buffers: AudioBuffer[]
): AudioBuffer {
  if (buffers.length === 0) {
    return ctx.createBuffer(1, 0, ctx.sampleRate);
  }

  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = ctx.createBuffer(1, totalLength, ctx.sampleRate);
  const channelData = result.getChannelData(0);

  let offset = 0;
  for (const buffer of buffers) {
    channelData.set(buffer.getChannelData(0), offset);
    offset += buffer.length;
  }

  return result;
}

/**
 * Get the best supported MIME type for MediaRecorder
 */
export function getBestMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/wav',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'audio/webm'; // Fallback
}

/**
 * Check if audio is silent (all samples near zero)
 */
export function isSilent(audioBuffer: AudioBuffer, threshold: number = 0.01): boolean {
  const data = audioBuffer.getChannelData(0);
  let maxAmp = 0;

  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > maxAmp) maxAmp = abs;
  }

  return maxAmp < threshold;
}

/**
 * Apply gain to audio buffer
 */
export function applyGain(audioBuffer: AudioBuffer, gain: number): AudioBuffer {
  const ctx = new AudioContext({ sampleRate: audioBuffer.sampleRate });
  const result = ctx.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate);
  const inputData = audioBuffer.getChannelData(0);
  const outputData = result.getChannelData(0);

  for (let i = 0; i < inputData.length; i++) {
    outputData[i] = Math.max(-1, Math.min(1, inputData[i] * gain));
  }

  return result;
}

/**
 * Convert AudioBuffer to WAV format for download/debugging
 */
export function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels: Float32Array[] = [];
  let offset = 0;
  let pos = 0;

  // Write WAV header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this demo)
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // Write interleaved data
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  while (pos < length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], { type: 'audio/wav' });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}
