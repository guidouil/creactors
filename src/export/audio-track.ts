import { EncodedAudioPacketSource, EncodedPacket } from 'mediabunny';
import type { AudioTrack } from '../audio/types';
import { renderAudioChunk } from '../audio/sampling';
import { ExportCapabilityError, ExportResourceError } from './errors';

export class AudioExportCapabilityError extends ExportCapabilityError {
  constructor() {
    super('No native video and audio encoding configuration succeeded.');
    this.name = 'AudioExportCapabilityError';
  }
}

export type ExportAudioCodec = 'aac' | 'opus';
const SAMPLE_RATE = 48_000;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 30;

export function exportAudioConfig(codec: ExportAudioCodec, channels: number): AudioEncoderConfig {
  return {
    codec: codec === 'aac' ? 'mp4a.40.2' : 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: channels,
    bitrate: channels === 1 ? 128_000 : 192_000,
  };
}

/** Freeze/clamp settings, never mutate the decoded buffer or allocate a film-length mix. */
export function normalizedExportAudio(track: AudioTrack): AudioTrack {
  const { buffer } = track;
  if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0
    || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0
    || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1
    || !Number.isFinite(track.offset) || !Number.isFinite(track.volume)) {
    throw new ExportResourceError('The selected audio track is invalid.', false);
  }
  return { buffer, offset: Math.max(0, Math.min(track.offset, buffer.duration)), volume: Math.max(0, Math.min(track.volume, 1)) };
}

export async function audioProfileIsSupported(codec: ExportAudioCodec, track: AudioTrack): Promise<boolean> {
  if (typeof globalThis.AudioEncoder === 'undefined' || typeof globalThis.AudioData === 'undefined') return false;
  return (await AudioEncoder.isConfigSupported(exportAudioConfig(codec, Math.min(2, track.buffer.numberOfChannels)))).supported === true;
}

/**
 * Native audio packets preserve encoder priming while their final duration is
 * trimmed to the film's exact sample clock. Feed one small chunk per video frame
 * so neither muxer track runs far ahead of the other.
 */
export class ExportAudioTrack {
  readonly source: EncodedAudioPacketSource;
  private readonly encoder: AudioEncoder;
  private readonly totalSamples: number;
  private readonly channels: number;
  private readonly failed: Promise<never>;
  private rejectFailure!: (error: unknown) => void;
  private failure: unknown;
  private writes: Promise<void> = Promise.resolve();
  private packets = 0;
  private lastEnd = 0;
  private closed = false;

  constructor(private readonly track: AudioTrack, private readonly codec: ExportAudioCodec, frames: number) {
    this.totalSamples = frames * SAMPLES_PER_FRAME;
    this.channels = Math.min(2, track.buffer.numberOfChannels);
    this.source = new EncodedAudioPacketSource(codec);
    this.failed = new Promise<never>((_resolve, reject) => { this.rejectFailure = reject; });
    void this.failed.catch(() => {});
    this.encoder = new AudioEncoder({ output: (chunk, metadata) => this.receive(chunk, metadata), error: error => this.fail(error) });
    try { this.encoder.configure(exportAudioConfig(codec, this.channels)); }
    catch (error) { this.encoder.close(); throw error; }
  }

  private fail(error: unknown): void {
    if (this.closed || this.failure !== undefined) return;
    this.failure = error;
    this.rejectFailure(error);
  }

  private check(): void {
    if (this.failure !== undefined) throw this.failure;
    if (this.closed) throw new Error('The native audio encoder is closed.');
  }

  private receive(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void {
    if (this.closed || this.failure !== undefined) return;
    try {
      const start = Math.round(chunk.timestamp * SAMPLE_RATE / 1_000_000);
      const requested = chunk.duration == null ? (this.codec === 'aac' ? 1024 : 960)
        : Math.round(chunk.duration * SAMPLE_RATE / 1_000_000);
      const length = Math.min(requested, this.totalSamples - start);
      if (length <= 0) return; // Encoder's final padded packets cannot extend the film.
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      // WebKit can provide a zero/absent AAC object type. Supply the canonical
      // AAC-LC AudioSpecificConfig for our fixed 48 kHz mono/stereo configuration.
      if (this.codec === 'aac' && metadata?.decoderConfig) {
        const description = metadata.decoderConfig.description;
        const data = description ? new Uint8Array(ArrayBuffer.isView(description) ? description.buffer
          : description, ArrayBuffer.isView(description) ? description.byteOffset : 0,
        description.byteLength) : null;
        if (!data || data.length < 2 || data[0] >> 3 === 0) {
          const config = (2 << 11) | (3 << 7) | (this.channels << 3);
          metadata = { ...metadata, decoderConfig: { ...metadata.decoderConfig, description: new Uint8Array([config >> 8, config & 255]) } };
        }
      }
      const packet = new EncodedPacket(bytes, 'key', start / SAMPLE_RATE, length / SAMPLE_RATE, this.packets++);
      this.lastEnd = Math.max(this.lastEnd, start + length);
      this.writes = this.writes.then(() => this.source.add(packet, metadata));
      void this.writes.catch(error => this.fail(error));
    } catch (error) { this.fail(error); }
  }

  async add(frame: number): Promise<void> {
    this.check();
    const planes = renderAudioChunk(this.track, frame * SAMPLES_PER_FRAME, SAMPLES_PER_FRAME, this.totalSamples, SAMPLE_RATE);
    const data = new Float32Array(SAMPLES_PER_FRAME * this.channels);
    for (let channel = 0; channel < this.channels; channel++) data.set(planes[channel], channel * SAMPLES_PER_FRAME);
    const sample = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE,
      numberOfFrames: SAMPLES_PER_FRAME, numberOfChannels: this.channels,
      timestamp: Math.round(frame / 30 * 1_000_000), data });
    try { this.encoder.encode(sample); }
    finally { sample.close(); }
    if (this.encoder.encodeQueueSize >= 4) {
      await Promise.race([
        new Promise<void>(resolve => this.encoder.addEventListener('dequeue', () => resolve(), { once: true })),
        this.failed,
      ]);
    }
    await Promise.race([this.writes, this.failed]);
    this.check();
  }

  async finish(): Promise<void> {
    this.check();
    await Promise.race([this.encoder.flush(), this.failed]);
    await Promise.race([this.writes, this.failed]);
    this.check();
    if (!this.packets || this.lastEnd < this.totalSamples - 1) {
      throw new Error('The native audio encoder did not cover the complete film.');
    }
    this.encoder.close();
    this.source.close();
    this.closed = true;
  }

  abort(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.encoder.state !== 'closed') this.encoder.close();
    // Output.cancel owns packet-source cleanup, including pre-start failures.
  }
}
