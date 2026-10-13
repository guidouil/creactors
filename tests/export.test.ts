import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneRenderer } from '../src/scene/renderer';
import type { SceneSpec } from '../src/scene/types';

const mock = vi.hoisted(() => ({
  jobs: [] as Array<{ source: { config: { codec: string }; frames: Array<{ timestamp: number; duration: number; keyFrame: boolean; renderedTime: number; size: [number, number] }> }; state: string; target: { buffer: ArrayBuffer | null }; format: { kind: string } }>,
  support: vi.fn(async (_codec: string, _options: { height: number }) => true),
  failFinalize: null as null | ((index: number) => boolean),
  failAdd: null as null | ((job: number, frame: number) => boolean),
  renderTime: 0,
  activeAdds: 0,
  maxActiveAdds: 0,
  encoders: [] as Array<{ submitted: number; emitted: number; maxPending: number; flushes: number; state: string }>,
  frameCloses: 0,
  nativeSources: [] as Array<{ frames: unknown[] }>,
  nativeConfigs: [] as VideoEncoderConfig[],
  frameTimes: new Map<number, number>(),
  frameSizes: new Map<number, [number, number]>(),
  timestampShift: 0,
  dropFrame: null as null | ((job: number, frame: number) => boolean),
}));

vi.mock('mediabunny', () => {
  class BufferTarget { buffer: ArrayBuffer | null = null; }
  class Mp4OutputFormat { kind = 'mp4'; constructor(readonly options: unknown) {} }
  class WebMOutputFormat { kind = 'webm'; }
  class Quality { constructor(readonly options: unknown) {} }
  class EncodedPacket {
    constructor(readonly data: Uint8Array, readonly type: string, readonly timestamp: number, readonly duration: number) {}
  }
  class CanvasSource {
    frames: Array<{ timestamp: number; duration: number; keyFrame: boolean; renderedTime: number; size: [number, number] }> = [];
    closed = false;
    constructor(private canvas: { width: number; height: number } | null, readonly config: { codec: string }) {}
    async add(timestamp: number, duration: number, options: { keyFrame: boolean }) {
      const job = mock.jobs.findIndex(item => item.source === this);
      if (mock.failAdd?.(job, this.frames.length)) throw new Error('Encoder resource failure');
      mock.activeAdds++;
      mock.maxActiveAdds = Math.max(mock.maxActiveAdds, mock.activeAdds);
      const size: [number, number] = this.canvas ? [this.canvas.width, this.canvas.height] : mock.frameSizes.get(timestamp)!;
      this.frames.push({ timestamp, duration, keyFrame: options.keyFrame, renderedTime: mock.renderTime, size });
      await Promise.resolve();
      mock.activeAdds--;
    }
    close() { this.closed = true; }
  }
  class EncodedVideoPacketSource extends CanvasSource {
    constructor(codec: string) { super(null, { codec }); mock.nativeSources.push(this); }
    async add(packet: any) {
      const time = mock.renderTime;
      mock.renderTime = mock.frameTimes.get(packet.timestamp) ?? time;
      try { await super.add(packet.timestamp, packet.duration, { keyFrame: packet.type === 'key' }); }
      finally { mock.renderTime = time; }
    }
  }
  class Output {
    state = 'pending';
    source!: CanvasSource;
    format: { kind: string };
    target: BufferTarget;
    constructor(options: { format: { kind: string }; target: BufferTarget }) {
      this.format = options.format;
      this.target = options.target;
      mock.jobs.push(this);
    }
    addVideoTrack(source: CanvasSource) { this.source = source; }
    setMetadataTags() {}
    async start() { this.state = 'started'; }
    async finalize() {
      if (mock.failFinalize?.(mock.jobs.indexOf(this))) throw new Error('Finalization failed');
      this.target.buffer = this.format.kind === 'mp4'
        ? new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]).buffer
        : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer;
      this.state = 'finalized';
    }
    async cancel() { this.state = 'canceled'; }
  }
  return { BufferTarget, CanvasSource, EncodedVideoPacketSource, EncodedPacket, Mp4OutputFormat, WebMOutputFormat, Output, Quality, canEncodeVideo: mock.support };
});

import { VideoExporter, ExportCapabilityError, ExportResourceError, keyframeIndices, detectProfiles, isExportAvailable } from '../src/export/video-exporter';
import { ProgressGuard } from '../src/export/progress-guard';
import { candidateProfiles, nativeAvcConfig } from '../src/export/profiles';

class NativeVideoFrame {
  readonly renderedTime = mock.renderTime;
  readonly size: [number, number];
  closed = false;
  constructor(canvas: { width: number; height: number }, readonly timing: { timestamp: number; duration: number }) {
    this.size = [canvas.width, canvas.height];
  }
  close() { this.closed = true; mock.frameCloses++; }
}

/** Model a software codec that emits nothing before flush and stalls at ≥4. */
class BufferedNativeEncoder {
  static async isConfigSupported(config: VideoEncoderConfig) {
    return { supported: await mock.support('avc', { ...config, frameRate: config.framerate } as any), config };
  }
  state = 'unconfigured';
  submitted = 0;
  emitted = 0;
  maxPending = 0;
  flushes = 0;
  private source = mock.nativeSources.at(-1);
  private pending: Array<{ frame: NativeVideoFrame; keyFrame: boolean }> = [];
  constructor(private callbacks: VideoEncoderInit) { mock.encoders.push(this); }
  configure(config: VideoEncoderConfig) { this.state = 'configured'; mock.nativeConfigs.push(config); }
  encode(frame: NativeVideoFrame, options: { keyFrame: boolean }) {
    const job = mock.jobs.findIndex(item => item.source === this.source);
    if (mock.failAdd?.(job, this.submitted)) throw new Error('Encoder resource failure');
    this.pending.push({ frame, keyFrame: options.keyFrame });
    this.submitted++;
    this.maxPending = Math.max(this.maxPending, this.pending.length);
  }
  async flush() {
    this.flushes++;
    if (this.pending.length >= 4) return new Promise<void>(() => {});
    for (const { frame, keyFrame } of this.pending) {
      const job = mock.jobs.findIndex(item => item.source === this.source);
      const frameIndex = Math.round(frame.timing.timestamp * 30 / 1_000_000);
      if (mock.dropFrame?.(job, frameIndex)) continue;
      mock.frameTimes.set(frame.timing.timestamp / 1_000_000, frame.renderedTime);
      // Test exact timestamp restoration without relying on rounded timing.
      const exact = Math.round(frame.timing.timestamp * 30 / 1_000_000) / 30;
      mock.frameTimes.set(exact, frame.renderedTime);
      mock.frameSizes.set(exact, frame.size);
      this.callbacks.output({ timestamp: frame.timing.timestamp + mock.timestampShift, byteLength: 1,
        type: keyFrame ? 'key' : 'delta', copyTo: () => {} } as unknown as EncodedVideoChunk, {});
      this.emitted++;
    }
    this.pending.length = 0;
  }
  close() { this.state = 'closed'; this.pending.length = 0; }
}

function scene(duration = 0.1, aspect = 9 / 16): SceneSpec {
  return {
    id: 'export-test', generatorVersion: '1', fontVersion: '1', sourceText: 'Test vidéo.',
    inputLanguage: 'fr', themeId: 'sunset', seed: 1, duration, fps: 30, aspect,
    fov: 38, objects: [], cameraTracks: [], chapters: [],
  };
}

function renderer(initialSize: [number, number] = [540, 960]) {
  let size: [number, number] = initialSize;
  const canvas = Object.assign(new EventTarget(), { width: size[0], height: size[1] });
  const instance = {
    canvas,
    lastTime: 4.2,
    getSize: () => [...size] as [number, number],
    resize: vi.fn((width: number, height: number) => { size = [width, height]; canvas.width = width; canvas.height = height; }),
    renderFrame: vi.fn((time: number) => { instance.lastTime = mock.renderTime = time; }),
  };
  return instance as unknown as SceneRenderer;
}

beforeEach(() => {
  mock.jobs.length = 0;
  mock.failAdd = mock.failFinalize = null;
  mock.renderTime = mock.activeAdds = mock.maxActiveAdds = 0;
  mock.encoders.length = mock.nativeSources.length = 0;
  mock.nativeConfigs.length = 0;
  mock.frameCloses = mock.timestampShift = 0;
  mock.dropFrame = null;
  mock.frameTimes.clear();
  mock.frameSizes.clear();
  mock.support.mockReset().mockResolvedValue(true);
  vi.stubGlobal('VideoEncoder', BufferedNativeEncoder);
  vi.stubGlobal('VideoFrame', NativeVideoFrame);
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('native video export', () => {
  it('checks the portrait configurations and returns an honest fallback list', async () => {
    mock.support.mockImplementation(async (codec, options) => codec === 'vp9' && options.height === 1280);
    const profiles = await detectProfiles();
    expect(profiles).toEqual([{ format: 'webm', codec: 'vp9', width: 720, height: 1280, bitrate: 6_000_000, fps: 30 }]);
    expect(candidateProfiles().map(profile => `${profile.codec}/${profile.height}`)).toEqual([
      'avc/1920', 'avc/1280', 'vp9/1920', 'vp9/1280', 'vp8/1920', 'vp8/1280',
    ]);
    expect(mock.support).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 1080, height: 1920, frameRate: 30, latencyMode: 'quality' }));
  });

  it('probes square dimensions at both quality levels with valid AVC levels', async () => {
    mock.support.mockImplementation(async (codec, options) => codec === 'vp9' && options.height === 720);
    expect(await detectProfiles(1920, 'square')).toEqual([
      { format: 'webm', codec: 'vp9', width: 720, height: 720, bitrate: 6_000_000, fps: 30 },
    ]);
    const profiles = candidateProfiles(1920, 'square');
    expect(profiles.map(profile => `${profile.codec}/${profile.width}x${profile.height}`)).toEqual([
      'avc/1080x1080', 'avc/720x720', 'vp9/1080x1080', 'vp9/720x720', 'vp8/1080x1080', 'vp8/720x720',
    ]);
    // 1080-square exceeds AVC level 3.1's 3600-macroblock frame limit.
    expect(nativeAvcConfig(profiles[0])).toMatchObject({ codec: 'avc1.420028', width: 1080, height: 1080 });
    expect(nativeAvcConfig(profiles[1])).toMatchObject({ codec: 'avc1.42001f', width: 720, height: 720 });
    expect(mock.support).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 1080, height: 1080, frameRate: 30 }));
    expect(candidateProfiles(1280, 'square').every(profile => profile.width === 720 && profile.height === 720)).toBe(true);
  });

  it('captures square probe and final frames, then restores the square preview', async () => {
    const preview = renderer([540, 540]);
    const onProfile = vi.fn();
    const result = await new VideoExporter().export(preview, scene(0.1, 1), { onProfile });
    expect(result).toMatchObject({ format: 'mp4', width: 1080, height: 1080, fps: 30 });
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1080 }));
    expect(mock.nativeConfigs).toHaveLength(2);
    expect(mock.nativeConfigs.every(config => config.width === 1080 && config.height === 1080)).toBe(true);
    expect(mock.jobs[0].source.frames).toHaveLength(24);
    expect(mock.jobs[1].source.frames).toHaveLength(3);
    expect(mock.jobs.every(job => job.source.frames.every(frame => frame.size[0] === 1080 && frame.size[1] === 1080))).toBe(true);
    expect(preview.getSize()).toEqual([540, 540]);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.jobs.every(job => job.target.buffer === null)).toBe(true);
  });

  it('discloses a square fallback when the full-size square smoke file fails', async () => {
    mock.failFinalize = index => index === 0;
    const preview = renderer([540, 540]);
    const onProfile = vi.fn();
    const result = await new VideoExporter().export(preview, scene(0.1, 1), { onProfile });
    expect(result).toMatchObject({ format: 'mp4', width: 720, height: 720 });
    expect(mock.jobs[0].state).toBe('canceled');
    expect(onProfile).toHaveBeenCalledOnce();
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ width: 720, height: 720 }));
    expect(mock.jobs[2].source.frames.every(frame => frame.size[0] === 720 && frame.size[1] === 720)).toBe(true);
    expect(preview.getSize()).toEqual([540, 540]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('exports absolute timestamps with awaited backpressure and restores preview', async () => {
    const preview = renderer();
    const progress: number[] = [];
    const result = await new VideoExporter().export(preview, scene(), { onProgress: value => progress.push(value) });
    expect(result).toMatchObject({ format: 'mp4', width: 1080, height: 1920, fps: 30 });
    expect(result.blob.type).toBe('video/mp4');
    expect(mock.jobs).toHaveLength(2);
    expect(mock.jobs[1].source.frames.map(frame => [frame.timestamp, frame.renderedTime, frame.duration])).toEqual([
      [0, 0, 1 / 30], [1 / 30, 1 / 30, 1 / 30], [2 / 30, 2 / 30, 1 / 30],
    ]);
    expect(mock.maxActiveAdds).toBe(1);
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.jobs.every(job => job.target.buffer === null)).toBe(true);
    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it('waits for imported video samples before capturing both codec probes and final frames', async () => {
    const preview = renderer();
    preview.renderFrameAsync = vi.fn(async (time: number) => {
      // The current canvas remains unchanged until the asynchronous decoder ends.
      await Promise.resolve();
      preview.renderFrame(time);
    });
    const spec = scene();
    spec.finalImages = [{
      id: 'video', asset: { name: 'clip.mp4', source: 'thumbnail', width: 16, height: 9, video: { source: 'local', duration: 0.03 } },
      baseDuration: 0, width: 1, height: 1, position: [0, 0, -9], rotation: [0, 0, 0], scale: 1,
      entrance: { start: 0, end: 0.01, from: [0, 0, -90], easing: 'linear' },
      exit: { start: 0.06, end: 0.1, to: [0, 0, 5], easing: 'linear' }, visibleInterval: [0, 0.1],
    }];
    await new VideoExporter().export(preview, spec);
    expect(preview.renderFrameAsync).toHaveBeenCalledTimes(27);
    expect(mock.jobs[0]!.source.frames.every(frame => frame.renderedTime === 0.05)).toBe(true);
    expect(mock.jobs[1]!.source.frames.map(frame => frame.renderedTime)).toEqual([0, 1 / 30, 2 / 30]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('requires real encode/finalize smoke success, then discloses the selected profile', async () => {
    mock.failFinalize = index => index === 0;
    const onProfile = vi.fn();
    const result = await new VideoExporter().export(renderer(), scene(), { onProfile });
    expect(result.height).toBe(1280);
    expect(mock.jobs[0].state).toBe('canceled');
    expect(onProfile).toHaveBeenCalledOnce();
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ format: 'mp4', height: 1280 }));
  });

  it.each([
    { aspect: 9 / 16, height: 1920 },
    { aspect: 1, height: 1080 },
  ])('returns actual WebM at aspect $aspect when native AVC cannot encode', async ({ aspect, height }) => {
    mock.support.mockImplementation(async codec => codec === 'vp8');
    const result = await new VideoExporter().export(renderer(), scene(0.1, aspect));
    expect(result).toMatchObject({ format: 'webm', width: 1080, height });
    expect(result.blob.type).toBe('video/webm');
    expect(mock.jobs[1].source.config.codec).toBe('vp8');
    expect(mock.jobs.every(job => job.source.frames.every(frame => frame.size[0] === 1080 && frame.size[1] === height))).toBe(true);
  });

  it('fails clearly when WebCodecs or all actual configurations are unavailable', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    expect(isExportAvailable()).toBe(false);
    await expect(new VideoExporter().export(renderer(), scene())).rejects.toBeInstanceOf(ExportCapabilityError);
    vi.stubGlobal('VideoEncoder', BufferedNativeEncoder);
    mock.support.mockResolvedValue(false);
    await expect(new VideoExporter().export(renderer(), scene())).rejects.toBeInstanceOf(ExportCapabilityError);
    expect(mock.jobs).toHaveLength(0);
  });

  it.each([
    { aspect: 9 / 16, size: [540, 960] as [number, number] },
    { aspect: 1, size: [540, 540] as [number, number] },
  ])('cancels encoding at aspect $aspect and restores the renderer without leaving file data', async ({ aspect, size }) => {
    const preview = renderer(size);
    const controller = new AbortController();
    await expect(new VideoExporter().export(preview, scene(2, aspect), {
      signal: controller.signal,
      onProgress: value => { if (value > 0) controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.jobs[1].state).toBe('canceled');
    expect(mock.jobs.every(job => job.target.buffer === null)).toBe(true);
    expect(preview.getSize()).toEqual(size);
    expect(preview.lastTime).toBe(4.2);
  });

  it('offers a disclosed 720p retry after a full-resolution resource failure', async () => {
    mock.failAdd = (job, frame) => job === 1 && frame === 1;
    const preview = renderer();
    await expect(new VideoExporter().export(preview, scene())).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: true });
    expect(mock.jobs[1].state).toBe('canceled');
    expect(preview.getSize()).toEqual([540, 960]);
  });

  it.each([
    { preferredHeight: 1920 as const, retryAt720p: true },
    { preferredHeight: 1280 as const, retryAt720p: false },
  ])('offers a square resource retry only from full quality ($preferredHeight)', async ({ preferredHeight, retryAt720p }) => {
    mock.failAdd = (job, frame) => job === 1 && frame === 1;
    const preview = renderer([540, 540]);
    await expect(new VideoExporter().export(preview, scene(0.1, 1), { preferredHeight }))
      .rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p });
    expect(mock.jobs[1].state).toBe('canceled');
    expect(preview.getSize()).toEqual([540, 540]);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.jobs.every(job => job.target.buffer === null)).toBe(true);
  });

  it('offers the square low-quality retry after a full-size context loss', async () => {
    const preview = renderer([540, 540]);
    await expect(new VideoExporter().export(preview, scene(0.1, 1), {
      onProgress: value => { if (value > 0) preview.canvas.dispatchEvent(new Event('webglcontextlost')); },
    })).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: true });
    expect(preview.getSize()).toEqual([540, 540]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('uses the requested 720p retry rather than reproposing 1080p', async () => {
    const result = await new VideoExporter().export(renderer(), scene(), { preferredHeight: 1280 });
    expect(result.height).toBe(1280);
    expect(mock.support).toHaveBeenCalledOnce();
    expect(mock.support).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 720, height: 1280 }));
  });

  it('uses the legacy low-quality setting to export a 720-square retry', async () => {
    const preview = renderer([540, 540]);
    const result = await new VideoExporter().export(preview, scene(0.1, 1), { preferredHeight: 1280 });
    expect(result).toMatchObject({ width: 720, height: 720 });
    expect(mock.support).toHaveBeenCalledOnce();
    expect(mock.support).toHaveBeenCalledWith('avc', expect.objectContaining({ width: 720, height: 720 }));
    expect(mock.nativeConfigs.every(config => config.width === 720 && config.height === 720)).toBe(true);
    expect(mock.jobs.every(job => job.source.frames.every(frame => frame.size[0] === 720 && frame.size[1] === 720))).toBe(true);
    expect(preview.getSize()).toEqual([540, 540]);
  });

  it('adds keyframes at two-second intervals and exact cinematic cuts', () => {
    const spec = scene(5);
    spec.cameraTracks = [{ id: 'cut', start: 2.7, end: 5, primitive: 'CUT', from: { position: [0, 0, 5], target: [0, 0, 0], roll: 0 }, to: { position: [0, 0, 5], target: [0, 0, 0], roll: 0 }, easing: 'linear', cutBefore: true }];
    expect([...keyframeIndices(spec)].sort((a, b) => a - b)).toEqual([0, 60, 81, 120]);
  });

  it('drains software lookahead before four queued frames across the smoke and full film', async () => {
    const result = await new VideoExporter().export(renderer(), scene(12));
    expect(result.format).toBe('mp4');
    expect(mock.jobs[0].source.frames).toHaveLength(24);
    expect(mock.jobs[1].source.frames).toHaveLength(360);
    expect(mock.encoders.map(encoder => [encoder.maxPending, encoder.flushes, encoder.submitted, encoder.emitted, encoder.state])).toEqual([
      [3, 8, 24, 24, 'closed'], [3, 120, 360, 360, 'closed'],
    ]);
    expect(mock.frameCloses).toBe(384);
    expect(mock.jobs[1].source.frames.every((frame, index) => frame.timestamp === index / 30 && frame.duration === 1 / 30)).toBe(true);
    expect(nativeAvcConfig(candidateProfiles()[0])).toMatchObject({ codec: 'avc1.420028', latencyMode: 'quality', avc: { format: 'avc' } });
  });

  it('restores precise frame timing when Safari shifts canvas timestamps by one microsecond', async () => {
    mock.timestampShift = -1;
    await new VideoExporter().export(renderer(), scene(0.2));
    expect(mock.jobs[1].source.frames.map(frame => frame.timestamp)).toEqual([0, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 5 / 30]);
  });

  it('rejects a native encoder that silently omits a frame instead of creating a shortened film', async () => {
    mock.dropFrame = (job, frame) => job === 1 && frame === 1;
    const preview = renderer();
    await expect(new VideoExporter().export(preview, scene(0.2))).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: true });
    expect(mock.encoders.every(encoder => encoder.state === 'closed')).toBe(true);
    expect(mock.jobs[1].state).toBe('canceled');
    expect(mock.jobs.every(job => job.target.buffer === null)).toBe(true);
    expect(preview.getSize()).toEqual([540, 960]);
  });

  it('rejects durations beyond the agreed sixty-second output bound', async () => {
    await expect(new VideoExporter().export(renderer(), scene(61))).rejects.toBeInstanceOf(ExportResourceError);
    expect(mock.jobs).toHaveLength(0);
  });
});

describe('foreground progress watchdog', () => {
  it('aborts a stalled native call after thirty seconds in the foreground', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const guard = new ProgressGuard(controller, () => true);
    const pending = guard.wait(new Promise<void>(() => {}));
    const assertion = expect(pending).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it('does not count time spent in a hidden tab as a foreground stall', async () => {
    vi.useFakeTimers();
    const page = { hidden: true };
    vi.stubGlobal('document', page);
    const controller = new AbortController();
    const guard = new ProgressGuard(controller, () => false);
    let finish!: () => void;
    const pending = guard.wait(new Promise<void>(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.signal.aborted).toBe(false);
    page.hidden = false;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(controller.signal.aborted).toBe(false);
    finish();
    await pending;
  });
});
