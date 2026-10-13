import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  started: [] as number[],
  drawn: [] as number[],
  failure: null as Error | null,
}));

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      setPixelRatio() {}
      setSize() {}
      initTexture() {}
      render = vi.fn();
      async compileAsync() {}
      dispose() {}
    },
  };
});
vi.mock('../src/typography/objects', () => ({ prepareTypography: vi.fn() }));
vi.mock('../src/image/video', () => ({
  prepareVideoFrames: async () => ({
    async drawFrame(time: number, _context: unknown, isCurrent: () => boolean) {
      mock.started.push(time);
      await mock.gate;
      if (mock.failure) throw mock.failure;
      if (!isCurrent()) return false;
      mock.drawn.push(time);
      return true;
    },
    dispose() {},
  }),
}));

import { SceneRenderer } from '../src/scene/renderer';
import { withFinalImages } from '../src/scene/final-image';
import { futureDemo } from '../src/demos/future';
import type { ImageAsset } from '../src/image/types';

const video: ImageAsset = { source: 'data:image/png;base64,AA==', width: 16, height: 9, name: 'clip.mp4', video: { source: 'local', duration: 1.2 } };
const scene = () => withFinalImages({ ...futureDemo, objects: [] }, [video], 'before');
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let index = 0; index < 20; index++) await Promise.resolve(); }

beforeEach(() => {
  mock.gate = mock.failure = null;
  mock.started.length = mock.drawn.length = 0;
  vi.stubGlobal('Image', class { src = ''; async decode() {} });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage() {}, clearRect() {} }),
  }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('asynchronous video rendering', () => {
  it('keeps decoded samples during forward playback even when decoding spans multiple ticks', async () => {
    const renderer = new SceneRenderer({} as HTMLCanvasElement);
    const spec = scene();
    await renderer.prepare(spec);
    await flush();
    const arrival = spec.finalImages![0]!.entrance.end;
    const gate = deferred();
    mock.gate = gate.promise;
    renderer.renderFrame(arrival + 0.15);
    renderer.renderFrame(arrival + 0.18);
    renderer.renderFrame(arrival + 0.21);
    expect(mock.started).toHaveLength(1);
    gate.resolve();
    await flush();
    expect(mock.drawn[0]).toBeCloseTo(0.15, 10);
    expect(mock.drawn.at(-1)).toBeCloseTo(0.21, 10);
    expect(renderer.lastTime).toBeCloseTo(arrival + 0.21, 10);
    renderer.dispose();
  });

  it('rejects the pending sample after a backward seek and paints its replacement', async () => {
    const renderer = new SceneRenderer({} as HTMLCanvasElement);
    const spec = scene();
    await renderer.prepare(spec);
    await flush();
    const arrival = spec.finalImages![0]!.entrance.end;
    const gate = deferred();
    mock.gate = gate.promise;
    renderer.renderFrame(arrival + 0.95);
    renderer.renderFrame(arrival + 0.15);
    gate.resolve();
    await flush();
    expect(mock.drawn).toHaveLength(1);
    expect(mock.drawn[0]).toBeCloseTo(0.15, 10);
    renderer.dispose();
  });

  it('invalidates pending preview work before exact export/seeking and resizing', async () => {
    const renderer = new SceneRenderer({} as HTMLCanvasElement);
    const spec = scene();
    await renderer.prepare(spec);
    await flush();
    const arrival = spec.finalImages![0]!.entrance.end;
    const gate = deferred();
    mock.gate = gate.promise;
    renderer.renderFrame(arrival + 0.15);
    const exact = renderer.renderFrameAsync(arrival + 0.55);
    gate.resolve();
    await exact;
    expect(mock.drawn).toHaveLength(1);
    expect(mock.drawn[0]).toBeCloseTo(0.55, 10);
    expect(renderer.lastTime).toBeCloseTo(arrival + 0.55, 10);
    mock.drawn.length = 0;
    const resizeGate = deferred();
    mock.gate = resizeGate.promise;
    renderer.renderFrame(arrival + 0.58);
    renderer.resize(1080, 1920);
    resizeGate.resolve();
    await flush();
    expect(mock.drawn).toHaveLength(1);
    expect(mock.drawn[0]).toBeCloseTo(0.58, 10);
    renderer.dispose();
  });

  it('surfaces a decode failure once and releases stale scene work', async () => {
    const renderer = new SceneRenderer({} as HTMLCanvasElement);
    const spec = scene();
    await renderer.prepare(spec);
    await flush();
    const failure = new Error('Codec lost');
    mock.failure = failure;
    renderer.onMediaError = vi.fn();
    const arrival = spec.finalImages![0]!.entrance.end;
    renderer.renderFrame(arrival + 0.15);
    await flush();
    expect(renderer.onMediaError).toHaveBeenCalledExactlyOnceWith(failure);
    await expect(renderer.renderFrameAsync(arrival + 0.15)).rejects.toBe(failure);
    renderer.dispose();
  });
});
