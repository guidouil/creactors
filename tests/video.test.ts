import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  width: 1920, height: 1080, codedWidth: 1920, codedHeight: 1080,
  end: 1.2, start: 0, decodable: true, readable: true,
  inputs: [] as { disposed: boolean; dispose(): void }[],
  sinks: [] as { options: { width: number; height: number; poolSize: number } }[],
  seeks: [] as number[],
  timestamps: [0, 0.4, 0.8],
  importImage: vi.fn(async (_file: File) => ({ source: 'photo', width: 1, height: 1, name: 'photo.png' })),
}));

vi.mock('../src/image/importer', () => ({ importImage: mock.importImage, MAX_IMAGE_EDGE: 2048 }));
vi.mock('mediabunny', () => {
  class BlobSource { constructor(readonly blob: Blob) {} }
  class Input {
    disposed = false;
    constructor(readonly options: { source: BlobSource }) { mock.inputs.push(this); }
    async getPrimaryVideoTrack() {
      if (!mock.readable) throw new Error('Unrecognized file');
      return {
        getCodedWidth: async () => mock.codedWidth,
        getCodedHeight: async () => mock.codedHeight,
        getDisplayWidth: async () => mock.width,
        getDisplayHeight: async () => mock.height,
        getFirstTimestamp: async () => mock.start,
        computeDuration: async () => mock.end,
        canDecode: async () => mock.decodable,
      };
    }
    dispose() { this.disposed = true; }
  }
  class CanvasSink {
    constructor(_track: unknown, readonly options: { width: number; height: number; poolSize: number }) { mock.sinks.push(this); }
    async getCanvas(timestamp: number) { return { canvas: { timestamp }, timestamp, duration: 0.4 }; }
    async *canvases(timestamp: number) {
      mock.seeks.push(timestamp);
      const times = mock.timestamps.map(time => time + Math.max(0, mock.start));
      const first = times.reduce((latest, time, index) => time <= timestamp ? index : latest, 0);
      for (const time of times.slice(first)) yield { canvas: { timestamp: time }, timestamp: time, duration: 0.4 };
    }
  }
  return { BlobSource, Input, CanvasSink, MP4: 'mp4', QTFF: 'mov', WEBM: 'webm' };
});

import { importMedia, importVideo, MAX_VIDEO_DURATION, MAX_VIDEO_FILE_BYTES, prepareVideoFrames, videoFrameTime } from '../src/image/video';
import type { ImageAsset } from '../src/image/types';

function file(brand = 'isom', name = 'incorrect.png', type = 'image/png'): File {
  return new File([Uint8Array.from([0, 0, 0, 24]), 'ftyp', brand, Uint8Array.from([0, 0, 0, 0]), 'isom', 'mp42'], name, { type });
}

function canvas() {
  const result = {
    width: 0, height: 0,
    toDataURL: () => 'data:image/png;base64,AA==',
    getContext: () => context,
  };
  const context = { canvas: result, clearRect: vi.fn(), drawImage: vi.fn() };
  return result;
}

beforeEach(() => {
  Object.assign(mock, { width: 1920, height: 1080, codedWidth: 1920, codedHeight: 1080, end: 1.2, start: 0, decodable: true, readable: true });
  mock.inputs.length = mock.sinks.length = mock.seeks.length = 0;
  mock.importImage.mockClear();
  vi.stubGlobal('document', { createElement: canvas });
  vi.stubGlobal('FileReader', class {
    result: string | null = null;
    onload?: () => void;
    onerror?: () => void;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`;
        this.onload?.();
      });
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded local video import', () => {
  it('reads content despite incorrect extension/MIME, keeps the compressed clip and a still thumbnail', async () => {
    const asset = await importMedia(file());
    expect(asset).toMatchObject({ source: 'data:image/png;base64,AA==', name: 'incorrect.png', width: 1920, height: 1080,
      video: { duration: 1.2, source: expect.stringMatching(/^data:video\/mp4;base64,/) } });
    expect(mock.importImage).not.toHaveBeenCalled();
    expect(mock.sinks).toHaveLength(1);
    expect(mock.sinks[0]!.options.poolSize).toBe(1);
    expect(mock.inputs.every(input => input.disposed)).toBe(true);
  });

  it('recognizes WebM and keeps AVIF in the image importer', async () => {
    const webm = new File([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])], 'renamed.jpg', { type: 'image/jpeg' });
    expect((await importMedia(webm)).video?.source).toMatch(/^data:video\/webm;base64,/);
    await importMedia(file('avif', 'picture.mp4', 'video/mp4'));
    expect(mock.importImage).toHaveBeenCalledOnce();
  });

  it('bounds file size before reading and validates actual duration before thumbnail decoding', async () => {
    const oversized = { size: MAX_VIDEO_FILE_BYTES + 1, slice: vi.fn() } as unknown as File;
    await expect(importVideo(oversized)).rejects.toMatchObject({ kind: 'size' });
    expect(oversized.slice).not.toHaveBeenCalled();
    for (const end of [0, NaN, Infinity, MAX_VIDEO_DURATION + 0.01]) {
      mock.end = end;
      await expect(importVideo(file())).rejects.toMatchObject({ kind: 'duration' });
    }
    expect(mock.sinks).toHaveLength(0);
    expect(mock.inputs.every(input => input.disposed)).toBe(true);
  });

  it('checks coded dimensions before allocation and reports unsupported codecs cleanly', async () => {
    mock.codedWidth = 9000;
    await expect(importVideo(file())).rejects.toMatchObject({ kind: 'dimensions' });
    mock.codedWidth = 1920;
    mock.decodable = false;
    await expect(importVideo(file())).rejects.toMatchObject({ kind: 'decode' });
    mock.decodable = true;
    mock.readable = false;
    await expect(importVideo(file())).rejects.toMatchObject({ kind: 'decode' });
    expect(mock.sinks).toHaveLength(0);
    expect(mock.inputs.every(input => input.disposed)).toBe(true);
  });

  it('preserves orientation-aware display aspect while reducing the output edge', async () => {
    Object.assign(mock, { width: 2160, height: 3840, codedWidth: 3840, codedHeight: 2160, start: 0.05, end: 1.25 });
    const asset = await importVideo(file());
    expect([asset.width, asset.height]).toEqual([1152, 2048]);
    expect(asset.video?.duration).toBeCloseTo(1.2, 10);
  });
});

describe('absolute video samples', () => {
  it('plays once from arrival, freezes the end and handles invalid preview time', () => {
    expect([-5, 0, NaN].map(time => videoFrameTime(1.2, time))).toEqual([0, 0, 0]);
    expect(videoFrameTime(1.2, 0.4)).toBe(0.4);
    expect(videoFrameTime(1.2, 4)).toBeCloseTo(1.2, 6);
    expect(videoFrameTime(1.2, 4)).toBeLessThan(1.2);
  });

  it('reuses a bounded sequential decoder, seeks backward and holds the last source frame', async () => {
    const asset = await importVideo(file());
    const prepared = await prepareVideoFrames(asset);
    const context = canvas().getContext() as unknown as CanvasRenderingContext2D;
    for (const elapsed of [0.15, 0.55, 0.95, 2, 0.15]) await prepared.drawFrame(elapsed, context);
    expect(vi.mocked(context.drawImage).mock.calls.map(call => (call[0] as unknown as { timestamp: number }).timestamp)).toEqual([0, 0.4, 0.8, 0]);
    expect(mock.seeks).toEqual([0.15, 0.15]);
    expect(mock.sinks.at(-1)!.options.poolSize).toBe(2);
    prepared.dispose();
    expect(mock.inputs.every(input => input.disposed)).toBe(true);
  });

  it('does not commit a superseded seek and lets its replacement reuse the decoded frame', async () => {
    const asset = await importVideo(file());
    const prepared = await prepareVideoFrames(asset);
    const context = canvas().getContext() as unknown as CanvasRenderingContext2D;
    expect(await prepared.drawFrame(0.55, context, () => false)).toBe(false);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(await prepared.drawFrame(0.55, context)).toBe(true);
    expect(context.drawImage).toHaveBeenCalledOnce();
    prepared.dispose();
  });

  it('restores serialized local sources and rejects remote URLs before opening a decoder', async () => {
    const original = await importVideo(file());
    const restored: ImageAsset = JSON.parse(JSON.stringify(original));
    const prepared = await prepareVideoFrames(restored);
    prepared.dispose();
    const inputCount = mock.inputs.length;
    await expect(prepareVideoFrames({ ...restored, video: { ...restored.video!, source: 'https://example.com/clip.mp4' } })).rejects.toMatchObject({ kind: 'decode' });
    expect(mock.inputs).toHaveLength(inputCount);
  });
});
