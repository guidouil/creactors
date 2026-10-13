import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decompressFrame, parseGIF } from 'gifuct-js';
import type { SceneRenderer } from '../../src/scene/renderer';
import type { SceneSpec } from '../../src/scene/types';
import { colorCycleGifFixture } from '../fixtures/gif';

interface DebugApi {
  ready: Promise<void>;
  spec: SceneSpec;
  renderer: SceneRenderer;
  audio: unknown;
  seek(time: number): void;
}
type DebugWindow = Window & { __CREACTORS_DEV__: DebugApi };

async function openStudio(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalRequests.push(url.toString());
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__?.ready));
  await page.evaluate(async () => { await (window as unknown as DebugWindow).__CREACTORS_DEV__.ready; });
  await page.locator('[data-locale="en"]').click();
  return { verify() { expect(errors).toEqual([]); expect(externalRequests).toEqual([]); } };
}

async function createAndPause(page: Page, text = 'Make words move.') {
  await page.locator('.quote-input').fill(text);
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
}

async function squareFormat(page: Page) {
  await page.locator('[data-film-format="square"]').click();
  await expect(page.locator('[data-film-format="square"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-film-format="square"]')).toBeEnabled();
}

async function downloadGif(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.locator('.gif-download-button').click();
  const download = await downloaded;
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  expect(download.suggestedFilename().length).toBeLessThanOrEqual(76);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  expect(bytes.byteLength).toBeLessThan(5_000_000);
  const parsed = parseGIF(Uint8Array.from(bytes).buffer);
  const frames = parsed.frames.filter(frame => 'image' in frame);
  expect(frames.length).toBeGreaterThan(2);
  expect(frames.length).toBeLessThanOrEqual(350);
  expect(parsed.lsd.width * parsed.lsd.height * frames.length).toBeLessThanOrEqual(36_152_320);
  const loop = parsed.frames.find(frame => 'application' in frame);
  expect(loop && 'application' in loop ? loop.application.id : null).toBe('NETSCAPE2.0');
  expect(loop && 'application' in loop ? Array.from(loop.application.blocks) : null).toEqual([1, 0, 0]);
  const nativeSize = await page.evaluate(async encoded => {
    const image = new Image();
    image.src = `data:image/gif;base64,${encoded}`;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, bytes.toString('base64'));
  expect(nativeSize).toEqual([parsed.lsd.width, parsed.lsd.height]);
  await expect(page.locator('.message')).toContainText('Your GIF is ready.');
  return { parsed, frames, bytes };
}

for (const format of ['vertical', 'square'] as const) test(`downloads a genuine looping ${format} GIF matching the complete film and restores preview`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  if (format === 'square') await squareFormat(page);
  await createAndPause(page);
  const original = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(1);
    return { spec: dev.spec, size: dev.renderer.getSize(), time: dev.renderer.lastTime };
  });
  const { parsed, frames } = await downloadGif(page);
  expect(parsed.lsd.width / parsed.lsd.height).toBe(format === 'square' ? 1 : 9 / 16);
  expect(frames.reduce((sum, frame) => sum + frame.gce.delay, 0) / 100).toBeCloseTo(original.spec.duration, 2);
  const object = original.spec.objects[0]!;
  const times = [(object.readingInterval[0] + object.readingInterval[1]) / 2, original.spec.posterTime ?? 2];
  for (const time of times) {
    const index = Math.min(frames.length - 1, Math.floor(time / original.spec.duration * frames.length));
    const frame = decompressFrame(frames[index]!, parsed.gct, true);
    const report = await page.evaluate(async sample => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      const size = dev.renderer.getSize(), previousTime = dev.renderer.lastTime;
      const canvas = document.createElement('canvas'); canvas.width = sample.width; canvas.height = sample.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      try {
        dev.renderer.resize(sample.width, sample.height);
        await dev.renderer.renderFrameAsync(sample.time);
        context.drawImage(dev.renderer.canvas, 0, 0);
        const reference = context.getImageData(0, 0, sample.width, sample.height).data;
        const gif = Uint8Array.from(atob(sample.rgba), character => character.charCodeAt(0));
        let error = 0;
        for (let offset = 0; offset < reference.length; offset += 4) for (let channel = 0; channel < 3; channel++) error += Math.abs(reference[offset + channel]! - gif[offset + channel]!);
        return error / (sample.width * sample.height * 3);
      } finally { dev.renderer.resize(...size); dev.renderer.renderFrame(previousTime); }
    }, { width: parsed.lsd.width, height: parsed.lsd.height, time: index * original.spec.duration / frames.length, rgba: Buffer.from(frame.patch).toString('base64') });
    expect(report).toBeLessThan(4);
  }
  expect(await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, size: dev.renderer.getSize(), time: dev.renderer.lastTime };
  })).toEqual(original);
  await page.screenshot({ path: testInfo.outputPath(`gif-${format}.png`), fullPage: true });
  diagnostics.verify();
});

async function videoFixture(page: Page) {
  const data = await page.evaluate(async () => {
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const target = new media.BufferTarget();
    const output = new media.Output({ target, format: new media.Mp4OutputFormat() });
    const source = new media.CanvasSource(canvas, { codec: 'avc', bitrate: 200_000 });
    output.addVideoTrack(source, { frameRate: 2.5 });
    await output.start();
    for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
      context.fillStyle = color; context.fillRect(0, 0, 64, 64);
      await source.add(index * 0.4, 0.4, { keyFrame: true });
    }
    source.close(); await output.finalize();
    return [...new Uint8Array(target.buffer!)];
  });
  return { name: 'colors.mp4', mimeType: 'video/mp4', buffer: Buffer.from(data) };
}

test('keeps imported GIF and video frames in the exported loop while preserving selected audio', async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await squareFormat(page);
  await createAndPause(page, 'Go.');
  await page.locator('.audio-button').click();
  await page.locator('[data-audio-preset="oh-no"]').click();
  await expect(page.locator('[data-audio-preset="oh-no"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.audio-button').click();
  await page.locator('.image-file').setInputFiles([
    { name: 'colors.gif', mimeType: 'image/gif', buffer: colorCycleGifFixture() },
    await videoFixture(page),
  ]);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '2');
  await expect(page.locator('.gif-download-button')).toBeEnabled();
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  const { parsed, frames } = await downloadGif(page);
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (const [imageIndex, image] of original.finalImages!.entries()) {
    for (const [index, offset] of (imageIndex === 0 ? [0.1, 0.35, 0.75] : [0.1, 0.55, 0.95]).entries()) {
      const frameIndex = Math.min(frames.length - 1, Math.ceil((image.entrance.end + offset) / original.duration * frames.length));
      const frame = decompressFrame(frames[frameIndex]!, parsed.gct, true);
      const center = (Math.floor(frame.dims.height / 2) * frame.dims.width + Math.floor(frame.dims.width / 2)) * 4;
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(frame.patch[center + channel]! - colors[index]![channel]!)).toBeLessThan(20);
    }
  }
  await page.locator('.audio-button').click();
  await expect(page.locator('[data-audio-preset="oh-no"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__.audio))).toBe(true);
  diagnostics.verify();
});

test('offers localized GIF export without a native video encoder on a small phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.addInitScript(() => { Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: undefined }); });
  const diagnostics = await openStudio(page);
  await squareFormat(page);
  await createAndPause(page, 'Bonjour.');
  await expect(page.locator('.download-button')).toBeDisabled();
  await expect(page.locator('.gif-download-button')).toBeEnabled();
  await page.locator('[data-locale="fr"]').click();
  await expect(page.locator('.gif-download-button')).toHaveAccessibleName('Télécharger le GIF animé');
  const layout = await page.locator('.gif-download-button').boundingBox();
  expect(layout!.width).toBeGreaterThanOrEqual(44);
  expect(layout!.height).toBeGreaterThanOrEqual(44);
  expect(layout!.x).toBeGreaterThanOrEqual(0);
  expect(layout!.x + layout!.width).toBeLessThanOrEqual(320);
  expect(layout!.y + layout!.height).toBeLessThanOrEqual(667);
  await page.screenshot({ path: testInfo.outputPath('gif-mobile.png'), fullPage: true });
  await page.locator('[data-locale="en"]').click();
  await downloadGif(page);
  await expect(page.locator('.download-button')).toBeDisabled();
  diagnostics.verify();
});

test('cancels GIF encoding, restores preview and permits a successful retry', async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await createAndPause(page, 'A complete message deserves time to move and be read.');
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(1.2); return { size: dev.renderer.getSize(), time: dev.renderer.lastTime };
  });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('.gif-download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await expect(page.locator('.gif-download-button')).toBeDisabled();
  await expect(page.locator('[data-film-format="square"]')).toBeDisabled();
  await page.locator('.cancel-export-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('.gif-download-button')).toBeEnabled();
  expect(downloads).toBe(0);
  expect(await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { size: dev.renderer.getSize(), time: dev.renderer.lastTime };
  })).toEqual(before);
  await downloadGif(page);
  expect(downloads).toBe(1);
  diagnostics.verify();
});
