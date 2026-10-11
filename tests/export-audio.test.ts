import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneRenderer } from '../src/scene/renderer';
import type { SceneSpec } from '../src/scene/types';

const state = vi.hoisted(() => ({
  jobs: [] as any[],
  audioEncoders: [] as any[],
  audioSupport: vi.fn(async (_config: any) => true),
  failAudioFinalize: false,
  audioDataClosed: 0,
  failConfigure: false,
}));

vi.mock('mediabunny', () => {
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class Mp4OutputFormat { kind = 'mp4'; }
  class WebMOutputFormat { kind = 'webm'; }
  class CanvasSource { frames: any[] = []; closed = false; constructor(_canvas: unknown, readonly config: any) {}
    async add(timestamp: number, duration: number) { this.frames.push({ timestamp, duration }); }
    close() { this.closed = true; }
  }
  class EncodedVideoPacketSource extends CanvasSource { constructor(codec: string) { super(null, { codec }); }
    async add(packet: any) { await super.add(packet.timestamp, packet.duration); }
  }
  class EncodedAudioPacketSource { packets: any[] = []; closed = false; constructor(readonly codec: string) {}
    async add(packet: any, metadata: any) { this.packets.push({ packet, metadata }); }
    close() { this.closed = true; }
  }
  class EncodedPacket { constructor(readonly data: Uint8Array, readonly type: string, readonly timestamp: number, readonly duration: number) {} }
  class Output {
    state = 'pending'; audio?: EncodedAudioPacketSource; video?: CanvasSource;
    target: BufferTarget; format: { kind: string };
    constructor(options: { format: { kind: string }; target: BufferTarget }) { Object.assign(this, options); this.target = options.target; this.format = options.format; state.jobs.push(this); }
    addVideoTrack(source: CanvasSource) { this.video = source; }
    addAudioTrack(source: EncodedAudioPacketSource) { this.audio = source; }
    setMetadataTags() {}
    async start() { this.state = 'started'; }
    async finalize() {
      if (state.failAudioFinalize && this.audio) throw new Error('Audio mux failure');
      this.target.buffer = this.format.kind === 'mp4'
        ? new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]).buffer
        : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer;
      this.state = 'finalized';
    }
    async cancel() { this.state = 'canceled'; }
  }
  class Quality { constructor(readonly options: unknown) {} }
  return { BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, EncodedVideoPacketSource,
    EncodedAudioPacketSource, EncodedPacket, Output, Quality, canEncodeVideo: async () => true };
});

import { AudioExportCapabilityError, VideoExporter } from '../src/export/video-exporter';
import { ExportAudioTrack, normalizedExportAudio } from '../src/export/audio-track';

class TestAudioData { closed = false; constructor(readonly init: AudioDataInit) {}
  close() { this.closed = true; state.audioDataClosed++; }
}
class TestAudioEncoder extends EventTarget {
  static async isConfigSupported(config: AudioEncoderConfig) { return { supported: await state.audioSupport(config), config }; }
  state = 'unconfigured'; encodeQueueSize = 0; config!: AudioEncoderConfig; samples: AudioDataInit[] = [];
  constructor(private callbacks: AudioEncoderInit) { super(); state.audioEncoders.push(this); }
  configure(config: AudioEncoderConfig) { if (state.failConfigure) throw new Error('Configure failed'); this.config = config; this.state = 'configured'; }
  encode(sample: TestAudioData) {
    this.samples.push(sample.init);
    const chunk = { timestamp: sample.init.timestamp, duration: Math.round(sample.init.numberOfFrames / sample.init.sampleRate * 1e6),
      byteLength: 2, copyTo(destination: Uint8Array) { destination.set([1, 2]); }, type: 'key' };
    this.callbacks.output(chunk as EncodedAudioChunk, { decoderConfig: { codec: this.config.codec,
      sampleRate: this.config.sampleRate, numberOfChannels: this.config.numberOfChannels, description: new Uint8Array([0, 0]) } });
  }
  async flush() {
    // Model native codec tail padding: the film must end at its video clock.
    const last = this.samples.at(-1);
    if (last) this.callbacks.output({ timestamp: last.timestamp + Math.round(last.numberOfFrames / last.sampleRate * 1e6),
      duration: 21_333, byteLength: 1, copyTo() {}, type: 'key' } as EncodedAudioChunk, {});
  }
  close() { this.state = 'closed'; }
}
class TestVideoEncoder {
  static async isConfigSupported(config: VideoEncoderConfig) { return { supported: true, config }; }
  state = 'unconfigured';
  constructor(private callbacks: VideoEncoderInit) {}
  configure() { this.state = 'configured'; }
  encode(frame: { timing: { timestamp: number; duration: number } }) {
    this.callbacks.output({ timestamp: frame.timing.timestamp, duration: frame.timing.duration,
      byteLength: 1, copyTo() {}, type: 'key' } as EncodedVideoChunk, {});
  }
  async flush() {}
  close() { this.state = 'closed'; }
}
function buffer(duration = 1, channels = 2): AudioBuffer {
  const data = Array.from({ length: channels }, (_, channel) => new Float32Array(Math.round(duration * 48_000)).fill(channel ? -0.4 : 0.4));
  return { sampleRate: 48_000, duration, numberOfChannels: channels, length: data[0].length, getChannelData: (channel: number) => data[channel] } as AudioBuffer;
}
function renderer(): SceneRenderer {
  let size: [number, number] = [540, 960];
  const value = { canvas: new EventTarget(), lastTime: 1.2, getSize: () => [...size], resize: (w: number, h: number) => { size = [w, h]; },
    renderFrame: (time: number) => { value.lastTime = time; } };
  return value as unknown as SceneRenderer;
}
function scene(duration = 0.13): SceneSpec {
  return { id: 'audio-export', generatorVersion: '1', fontVersion: '1', sourceText: 'Sound!', inputLanguage: 'en',
    themeId: 'monochrome', seed: 1, duration, fps: 30, aspect: 9 / 16, fov: 38, objects: [], cameraTracks: [], chapters: [] };
}

beforeEach(() => {
  state.jobs.length = state.audioEncoders.length = 0;
  state.audioDataClosed = 0;
  state.failConfigure = state.failAudioFinalize = false;
  state.audioSupport.mockReset().mockResolvedValue(true);
  vi.stubGlobal('AudioEncoder', TestAudioEncoder);
  vi.stubGlobal('AudioData', TestAudioData);
  vi.stubGlobal('VideoEncoder', TestVideoEncoder);
  vi.stubGlobal('VideoFrame', class { constructor(_canvas: unknown, readonly timing: unknown) {} close() {} });
  vi.stubGlobal('isSecureContext', true);
});
afterEach(() => vi.unstubAllGlobals());

describe('native audio in deterministic video export', () => {
  it('muxes AAC in MP4, probes both tracks, and closes every bounded PCM chunk', async () => {
    const view = renderer();
    const result = await new VideoExporter().export(view, scene(), { audio: { buffer: buffer(), offset: 0.2, volume: 0.5 } });
    expect(result).toMatchObject({ format: 'mp4', audioCodec: 'aac' });
    expect(state.jobs).toHaveLength(2);
    expect(state.jobs[0].audio.packets).toHaveLength(24);
    const final = state.jobs[1];
    expect(final.video.frames).toHaveLength(4);
    expect(final.audio.packets).toHaveLength(4);
    expect(final.audio.packets.at(-1).packet.timestamp + final.audio.packets.at(-1).packet.duration).toBeCloseTo(4 / 30, 10);
    expect(state.audioDataClosed).toBe(28);
    expect(state.audioEncoders.every(encoder => encoder.samples.every((sample: AudioDataInit) => sample.numberOfFrames === 1600))).toBe(true);
    expect(state.audioEncoders[1].samples[1].data).toBeInstanceOf(Float32Array);
    const samples = state.audioEncoders[1].samples[1].data as Float32Array;
    expect(samples[0]).toBeCloseTo(0.2);
    expect(samples[1600]).toBeCloseTo(-0.2);
    expect(final.audio.packets[0].metadata.decoderConfig.description).toEqual(new Uint8Array([0x11, 0x90]));
    expect(view.getSize()).toEqual([540, 960]);
    expect(view.lastTime).toBe(1.2);
    expect(state.jobs.every(job => job.target.buffer === null)).toBe(true);
  });

  it('falls back to a genuine WebM with Opus when AAC is unsupported', async () => {
    state.audioSupport.mockImplementation(async config => config.codec === 'opus');
    const onProfile = vi.fn();
    const result = await new VideoExporter().export(renderer(), scene(), { audio: { buffer: buffer(), offset: 0, volume: 1 }, onProfile });
    expect(result).toMatchObject({ format: 'webm', audioCodec: 'opus' });
    expect(result.blob.type).toBe('video/webm');
    expect(state.jobs.every(job => job.audio.codec === 'opus')).toBe(true);
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ format: 'webm' }));
  });

  it('reports unavailable audio encoding instead of silently dropping a selected soundtrack', async () => {
    state.audioSupport.mockResolvedValue(false);
    await expect(new VideoExporter().export(renderer(), scene(), { audio: { buffer: buffer(), offset: 0, volume: 1 } })).rejects.toBeInstanceOf(AudioExportCapabilityError);
    expect(state.jobs).toHaveLength(0);
    vi.stubGlobal('AudioEncoder', undefined);
    await expect(new VideoExporter().export(renderer(), scene(), { audio: { buffer: buffer(), offset: 0, volume: 1 } })).rejects.toBeInstanceOf(AudioExportCapabilityError);
    // The same browser still gets the unchanged, explicitly silent export path.
    await expect(new VideoExporter().export(renderer(), scene())).resolves.toMatchObject({ format: 'mp4' });
  });

  it('tests actual audio mux finalization before declaring capability', async () => {
    state.failAudioFinalize = true;
    await expect(new VideoExporter().export(renderer(), scene(), { audio: { buffer: buffer(), offset: 0, volume: 1 } })).rejects.toBeInstanceOf(AudioExportCapabilityError);
    expect(state.jobs).toHaveLength(6);
    expect(state.jobs.every(job => job.state === 'canceled' && job.target.buffer === null)).toBe(true);
    expect(state.audioEncoders.every(encoder => encoder.state === 'closed')).toBe(true);
  });

  it('repeats a short selected excerpt until the film ends with bounded PCM chunks', async () => {
    await new VideoExporter().export(renderer(), scene(0.2), { audio: { buffer: buffer(0.08, 1), offset: 0, volume: 1 } });
    const encoder = state.audioEncoders.at(-1);
    const repeated = encoder.samples.slice(3) as AudioDataInit[];
    expect(repeated).toHaveLength(3);
    expect(repeated.every(sample => (sample.data as Float32Array).some(value => value > 0.1))).toBe(true);
    expect((repeated[0].data as Float32Array)[0]).toBeCloseTo(0.4);
    expect((repeated.at(-1)!.data as Float32Array).at(-1)).toBeLessThan(0.001);
  });

  it('cancels both native tracks and restores the preview', async () => {
    const controller = new AbortController();
    const view = renderer();
    await expect(new VideoExporter().export(view, scene(2), { audio: { buffer: buffer(), offset: 0, volume: 1 }, signal: controller.signal,
      onProgress: value => { if (value > 0) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.jobs.at(-1).state).toBe('canceled');
    expect(state.audioEncoders.every(encoder => encoder.state === 'closed')).toBe(true);
    expect(view.lastTime).toBe(1.2);
  });

  it('clamps a settings snapshot and rejects invalid source data', () => {
    const source = { buffer: buffer(), offset: -4, volume: 6 };
    expect(normalizedExportAudio(source)).toEqual({ buffer: source.buffer, offset: 0, volume: 1 });
    expect(source.volume).toBe(6);
    expect(() => normalizedExportAudio({ ...source, offset: NaN })).toThrow('invalid');
    expect(() => normalizedExportAudio({ ...source, buffer: buffer(0) })).toThrow('invalid');
  });

  it('frees a native audio encoder that refuses configuration', () => {
    state.failConfigure = true;
    expect(() => new ExportAudioTrack({ buffer: buffer(), offset: 0, volume: 1 }, 'aac', 3)).toThrow('Configure failed');
    expect(state.audioEncoders[0].state).toBe('closed');
  });
});
