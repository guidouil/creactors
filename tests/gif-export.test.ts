import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneRenderer } from '../src/scene/renderer';
import type { SceneSpec } from '../src/scene/types';

const mock = vi.hoisted(() => ({
  jobs: [] as Array<{
    config: { width: number; height: number; maxBytes: number; paletteSize: number };
    frames: Array<{ time: number; delay: number; size: [number, number] }>;
    finished: boolean;
  }>,
  canvases: [] as Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }>,
  captures: [] as Array<{ time: number; size: [number, number] }>,
  renderTime: 0,
  failAt: null as null | ((job: number, frame: number) => boolean),
  failFinish: null as null | ((job: number) => boolean),
  oversizedFinish: false,
  brokenHeader: false,
  missingContext: false,
}));

vi.mock('../src/export/gif-encoder', () => {
  class GifSizeError extends Error {
    constructor(readonly maxBytes: number) { super('GIF is too large'); this.name = 'GifSizeError'; }
  }
  class GifEncoder {
    readonly job: typeof mock.jobs[number];
    constructor(config: typeof mock.jobs[number]['config']) {
      this.job = { config, frames: [], finished: false };
      mock.jobs.push(this.job);
    }
    addFrame(_rgba: Uint8ClampedArray, delay: number) {
      if (mock.failAt?.(mock.jobs.indexOf(this.job), this.job.frames.length)) throw new GifSizeError(this.job.config.maxBytes);
      const capture = mock.captures.at(-1)!;
      this.job.frames.push({ time: capture.time, delay, size: capture.size });
    }
    finish(): Uint8Array<ArrayBuffer> {
      if (mock.failFinish?.(mock.jobs.indexOf(this.job))) throw new GifSizeError(this.job.config.maxBytes);
      this.job.finished = true;
      const bytes = new Uint8Array(mock.oversizedFinish ? 5_000_000 : 16);
      if (!mock.brokenHeader) bytes.set([71, 73, 70, 56, 57, 97]);
      return bytes;
    }
  }
  return { GifEncoder, GifSizeError };
});

import { GifExporter, GifExportSizeError } from '../src/export/gif-exporter';
import { candidateGifProfiles, GIF_MAX_BYTES, GIF_MAX_FRAMES, GIF_MAX_TOTAL_PIXELS, gifFrameTiming } from '../src/export/gif-profiles';

function scene(duration = 0.25, aspect = 9 / 16): SceneSpec {
  return {
    id: 'gif-export-test', generatorVersion: '1', fontVersion: '1', sourceText: 'Tout le film.',
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
    renderFrameAsync: vi.fn(async (time: number) => { await Promise.resolve(); instance.renderFrame(time); }),
  };
  return instance as unknown as SceneRenderer;
}

beforeEach(() => {
  mock.jobs.length = mock.canvases.length = mock.captures.length = 0;
  mock.renderTime = 0;
  mock.failAt = mock.failFinish = null;
  mock.oversizedFinish = mock.brokenHeader = mock.missingContext = false;
  vi.stubGlobal('document', {
    hidden: false,
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe('canvas');
      let capturedTime = 0;
      const canvas = {
        width: 300,
        height: 150,
        getContext: vi.fn(() => mock.missingContext ? null : {
          drawImage: vi.fn(() => { capturedTime = mock.renderTime; }),
          getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => {
            mock.captures.push({ time: capturedTime, size: [width, height] });
            return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
          }),
        }),
      };
      mock.canvases.push(canvas);
      return canvas;
    }),
  });
  // GIF export must work in browsers which cannot encode native video.
  vi.stubGlobal('VideoEncoder', undefined);
  vi.stubGlobal('VideoFrame', undefined);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('GIF export profiles and timeline', () => {
  it.each([9 / 16, 1])('bounds every short and long profile at aspect %s without cropping', aspect => {
    for (const duration of [0.01, 0.1, 2.345, 14, 29.99, 60]) {
      const profiles = candidateGifProfiles(duration, aspect);
      expect(profiles.length).toBeGreaterThan(1);
      for (const profile of profiles) {
        expect(profile.width / profile.height).toBe(aspect);
        expect(profile.height).toBeLessThanOrEqual(480);
        expect(profile.frameCount).toBeLessThanOrEqual(GIF_MAX_FRAMES);
        expect(profile.frameCount).toBeLessThanOrEqual(350);
        expect(profile.width * profile.height * profile.frameCount).toBeLessThanOrEqual(GIF_MAX_TOTAL_PIXELS);
        expect(profile.maxBytes).toBeLessThan(5_000_000);
        const timings = Array.from({ length: profile.frameCount }, (_, index) => gifFrameTiming(index, profile.frameCount, duration));
        expect(timings[0]!.time).toBe(0);
        expect(timings.at(-1)!.time).toBe(duration * (profile.frameCount - 1) / profile.frameCount);
        expect(timings.every(timing => timing.delayCentiseconds > 0)).toBe(true);
        expect(timings.reduce((total, timing) => total + timing.delayCentiseconds, 0)).toBe(Math.round(duration * 100));
      }
      expect(profiles.at(-1)!.width * profiles.at(-1)!.height).toBeLessThan(profiles[0]!.width * profiles[0]!.height);
    }
  });

  it('reduces the rate for a sixty-second film while still sampling its ending', () => {
    const profile = candidateGifProfiles(60, 1)[0]!;
    expect(profile.frameCount).toBe(350);
    expect(profile.fps).toBeCloseTo(350 / 60);
    expect(gifFrameTiming(profile.frameCount - 1, profile.frameCount, 60).time).toBeGreaterThan(59.8);
    expect(profile.width).toBeGreaterThan(300);
  });
});

describe('offline GIF export orchestration', () => {
  it.each([
    { aspect: 9 / 16, initial: [540, 960] as [number, number], output: [270, 480] },
    { aspect: 1, initial: [540, 540] as [number, number], output: [480, 480] },
  ])('captures the full authored $aspect timeline, discloses quality and restores the preview', async ({ aspect, initial, output }) => {
    const preview = renderer(initial);
    const onProfile = vi.fn();
    const progress: number[] = [];
    const result = await new GifExporter().export(preview, scene(0.25, aspect), { onProfile, onProgress: value => progress.push(value) });
    expect(result).toMatchObject({ format: 'gif', width: output[0], height: output[1], fps: 12 });
    expect(result.blob.type).toBe('image/gif');
    expect(result.blob.size).toBeLessThan(GIF_MAX_BYTES);
    expect(mock.jobs).toHaveLength(1);
    expect(mock.jobs[0]!.frames).toEqual([
      { time: 0, delay: 8, size: output },
      { time: 0.25 / 3, delay: 9, size: output },
      { time: 0.5 / 3, delay: 8, size: output },
    ]);
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ format: 'gif', width: output[0], height: output[1], paletteSize: 256 }));
    expect(preview.getSize()).toEqual(initial);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it.each(['video', 'animation'] as const)('awaits imported %s media at each absolute timestamp before capture', async kind => {
    const preview = renderer();
    const spec = scene();
    spec.finalImages = [{ asset: { [kind]: {} } }] as unknown as SceneSpec['finalImages'];
    await new GifExporter().export(preview, spec);
    expect(preview.renderFrameAsync).toHaveBeenCalledTimes(3);
    expect(mock.jobs[0]!.frames.map(frame => frame.time)).toEqual([0, 0.25 / 3, 0.5 / 3]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('retries capped compressed data with a smaller complete film and monotonic progress', async () => {
    mock.failAt = (job, frame) => job === 0 && frame === 2;
    const preview = renderer();
    const profileSizes: number[] = [];
    const progress: number[] = [];
    const result = await new GifExporter().export(preview, scene(1.25), {
      onProfile: profile => profileSizes.push(profile.width * profile.height),
      onProgress: value => progress.push(value),
    });
    expect(mock.jobs).toHaveLength(2);
    expect(mock.jobs[0]!.finished).toBe(false);
    expect(profileSizes[1]).toBeLessThan(profileSizes[0]!);
    const retried = mock.jobs[1]!;
    expect(retried.frames[0]!.time).toBe(0);
    expect(retried.frames.at(-1)!.time).toBeGreaterThan(1.1);
    expect(retried.frames.reduce((total, frame) => total + frame.delay, 0)).toBe(125);
    expect(result.width).toBe(retried.config.width);
    expect(result.height).toBe(retried.config.height);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
  });

  it.each(['write', 'finalize', 'oversized-output'] as const)('fails honestly after finite quality attempts when %s keeps exceeding the byte cap', async failure => {
    if (failure === 'write') mock.failAt = () => true;
    if (failure === 'finalize') mock.failFinish = () => true;
    if (failure === 'oversized-output') mock.oversizedFinish = true;
    const preview = renderer([540, 540]);
    const onProgress = vi.fn();
    await expect(new GifExporter().export(preview, scene(0.1, 1), { onProgress })).rejects.toBeInstanceOf(GifExportSizeError);
    expect(mock.jobs.length).toBe(candidateGifProfiles(0.1, 1).length);
    expect(mock.jobs.length).toBeLessThanOrEqual(7);
    expect(onProgress).not.toHaveBeenCalledWith(1);
    expect(preview.getSize()).toEqual([540, 540]);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.canvases[0]!.width).toBe(0);
  });

  it.each([9 / 16, 1])('cancels at aspect %s, removes listeners and allows a fresh export', async aspect => {
    const initial: [number, number] = aspect === 1 ? [540, 540] : [540, 960];
    const preview = renderer(initial);
    const removeListener = vi.spyOn(preview.canvas, 'removeEventListener');
    const controller = new AbortController();
    await expect(new GifExporter().export(preview, scene(0.25, aspect), {
      signal: controller.signal,
      onProgress: value => { if (value > 0) controller.abort(); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.jobs[0]!.frames).toHaveLength(1);
    expect(mock.jobs[0]!.finished).toBe(false);
    expect(preview.getSize()).toEqual(initial);
    expect(preview.lastTime).toBe(4.2);
    expect(removeListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    expect(mock.canvases[0]!.width).toBe(0);
    await expect(new GifExporter().export(preview, scene(0.1, aspect))).resolves.toMatchObject({ format: 'gif' });
  });

  it('checks an already aborted signal before allocating a capture or encoding', async () => {
    const preview = renderer();
    const controller = new AbortController();
    controller.abort();
    await expect(new GifExporter().export(preview, scene(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.jobs).toHaveLength(0);
    expect(mock.canvases).toHaveLength(0);
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('aborts a stalled imported-media sample promptly and restores the preview', async () => {
    const preview = renderer();
    preview.renderFrameAsync = vi.fn(() => new Promise<void>(() => {}));
    const spec = scene();
    spec.finalImages = [{ asset: { video: {} } }] as unknown as SceneSpec['finalImages'];
    const controller = new AbortController();
    const pending = new GifExporter().export(preview, spec, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.captures).toHaveLength(0);
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
  });

  it('bounds a stalled imported-media sample with the foreground watchdog', async () => {
    vi.useFakeTimers();
    const preview = renderer();
    preview.renderFrameAsync = vi.fn(() => new Promise<void>(() => {}));
    const spec = scene();
    spec.finalImages = [{ asset: { video: {} } }] as unknown as SceneSpec['finalImages'];
    const pending = new GifExporter().export(preview, spec);
    const failure = expect(pending).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: false });
    await vi.advanceTimersByTimeAsync(30_500);
    await failure;
    expect(mock.captures).toHaveLength(0);
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts when the WebGL context is lost before capturing stale pixels', async () => {
    const preview = renderer();
    const originalRender = preview.renderFrame.bind(preview);
    preview.renderFrame = vi.fn((time: number) => {
      originalRender(time);
      if (time === 0) preview.canvas.dispatchEvent(new Event('webglcontextlost'));
    });
    await expect(new GifExporter().export(preview, scene())).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: false });
    expect(mock.captures).toHaveLength(0);
    expect(preview.lastTime).toBe(4.2);
  });

  it('rejects a simultaneous export using the same renderer', async () => {
    const preview = renderer();
    preview.renderFrameAsync = vi.fn(() => new Promise<void>(() => {}));
    const spec = scene();
    spec.finalImages = [{ asset: { video: {} } }] as unknown as SceneSpec['finalImages'];
    const controller = new AbortController();
    const first = new GifExporter().export(preview, spec, { signal: controller.signal });
    const firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(new GifExporter().export(preview, spec)).rejects.toMatchObject({ name: 'ExportResourceError' });
    controller.abort();
    await firstFailure;
  });

  it.each(['capture', 'frame', 'header'] as const)('restores all preview resources on a %s failure', async failure => {
    const preview = renderer();
    if (failure === 'capture') mock.missingContext = true;
    if (failure === 'frame') preview.renderFrame = vi.fn((time: number) => { if (time === 0) throw new Error('Frame failed'); preview.lastTime = time; });
    if (failure === 'header') mock.brokenHeader = true;
    await expect(new GifExporter().export(preview, scene())).rejects.toMatchObject({ name: 'ExportResourceError', retryAt720p: false });
    expect(preview.getSize()).toEqual([540, 960]);
    expect(preview.lastTime).toBe(4.2);
    expect(mock.canvases[0]!.width).toBe(0);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 60.001])('rejects invalid duration %s before mutating the renderer', async duration => {
    const preview = renderer();
    await expect(new GifExporter().export(preview, scene(duration))).rejects.toMatchObject({ name: 'ExportResourceError' });
    expect(preview.resize).not.toHaveBeenCalled();
    expect(mock.canvases).toHaveLength(0);
    expect(mock.jobs).toHaveLength(0);
  });
});
