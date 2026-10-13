import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SceneSpec } from '../../src/scene/types';
import type { SceneRenderer } from '../../src/scene/renderer';

interface DebugApi {
  ready: Promise<void>;
  spec: SceneSpec;
  renderer: SceneRenderer & { renderFrameAsync(time: number): Promise<void> };
  seek(time: number): void;
  audio: unknown;
}

type DebugWindow = Window & { __CREACTORS_DEV__: DebugApi };
const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];

async function openStudio(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      externalRequests.push(url.toString());
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__?.ready));
  await page.evaluate(async () => { await (window as unknown as DebugWindow).__CREACTORS_DEV__.ready; });
  await page.locator('[data-locale="en"]').click();
  await page.locator('.quote-input').fill('Go.');
  return { verify() {
    expect(errors, 'Media must decode and render without uncaught errors').toEqual([]);
    expect(externalRequests, 'A local video must remain local').toEqual([]);
  } };
}

/** Three key frames encode a known, seekable 1.2-second animation without a wall clock. */
async function videoFixture(page: Page, withAudio = false) {
  const fixture = await page.evaluate(async withAudio => {
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const mp4 = await media.canEncodeVideo('avc', { width: 128, height: 96 })
      && (!withAudio || await media.canEncodeAudio('aac', { sampleRate: 48_000, numberOfChannels: 1 }));
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const context = canvas.getContext('2d')!;
    const target = new media.BufferTarget();
    const output = new media.Output({ target, format: mp4 ? new media.Mp4OutputFormat() : new media.WebMOutputFormat() });
    const source = new media.CanvasSource(canvas, { codec: mp4 ? 'avc' : 'vp9', bitrate: 500_000, keyFrameInterval: 0.4 });
    output.addVideoTrack(source, { frameRate: 2.5 });
    const audio = withAudio ? new media.AudioBufferSource({ codec: mp4 ? 'aac' : 'opus', bitrate: 96_000 }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();
    try {
      for (const [index, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) {
        context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
        await source.add(index * 0.4, 0.4, { keyFrame: true });
      }
      if (audio) {
        const sound = new AudioBuffer({ numberOfChannels: 1, length: 57_600, sampleRate: 48_000 });
        const samples = sound.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 48_000 * 440 * 2 * Math.PI) * 0.2;
        await audio.add(sound);
      }
      await output.finalize();
      return { bytes: [...new Uint8Array(target.buffer)], name: mp4 ? 'cycle.mp4' : 'cycle.webm', mimeType: mp4 ? 'video/mp4' : 'video/webm' };
    } catch (error) { await output.cancel(); throw error; }
  }, withAudio);
  return { name: fixture.name, mimeType: fixture.mimeType, buffer: Buffer.from(fixture.bytes) };
}

async function photoFixture(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffff00'; context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

async function createAndPause(page: Page) {
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
}

async function waitForMedia(page: Page, count: number) {
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', String(count));
  await expect(page.locator('.stage')).toHaveAttribute('aria-busy', 'false');
}

async function filmSpec(page: Page) {
  return page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
}

async function choosePlacement(page: Page, placement: 'before' | 'after') {
  await page.locator(`.image-placement [data-media-placement="${placement}"]:visible`).first().click();
  await expect(page.locator('.studio')).toHaveAttribute('data-media-placement', placement);
  await expect(page.locator('.stage')).toHaveAttribute('aria-busy', 'false');
  for (const button of await page.locator(`.image-placement [data-media-placement="${placement}"]`).all()) {
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
}

test('imports a local video before CREATE and renders its exact frames across out-of-order seeks', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await expect(page.locator('.image-file')).toHaveAttribute('accept', /video/);
  await expect(page.locator('.image-placement:visible')).toHaveCount(0);
  await page.locator('.image-file').setInputFiles(await videoFixture(page, true));
  await waitForMedia(page, 1);
  await expect(page.locator('.studio')).toHaveAttribute('data-media-placement', 'after');
  await expect(page.locator('.image-video-badge:visible')).toHaveCount(1);
  await createAndPause(page);
  const report = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const image = dev.spec.finalImages![0]!;
    const times = [0.15, 0.55, 0.95].map(offset => image.entrance.end + offset);
    const captures: string[] = [], pixels: number[][] = [];
    const probe = document.createElement('canvas'); probe.width = 144; probe.height = 256;
    const context = probe.getContext('2d')!;
    for (const time of times) {
      await dev.renderer.renderFrameAsync(time);
      captures.push(dev.renderer.canvas.toDataURL());
      context.drawImage(dev.renderer.canvas, 0, 0, 144, 256);
      pixels.push([...context.getImageData(72, 128, 1, 1).data].slice(0, 3));
    }
    const revisited = [];
    for (const time of [times[2]!, 0, times[0]!, dev.spec.duration, times[1]!, times[0]!, times[2]!]) {
      await dev.renderer.renderFrameAsync(time);
      if (times.includes(time)) revisited.push({ time, capture: dev.renderer.canvas.toDataURL() });
    }
    return { asset: image.asset, hold: image.exit.start - image.entrance.end, times, captures, pixels, revisited, audio: dev.audio };
  });
  expect(report.asset.source).toMatch(/^data:image\/png;base64,/);
  const video = (report.asset as typeof report.asset & { video: { source: string; duration: number } }).video;
  expect(video.source).toMatch(/^data:video\/(mp4|webm);base64,/);
  expect(video.duration).toBeCloseTo(1.2, 3);
  expect(report.asset.width / report.asset.height).toBeCloseTo(4 / 3, 8);
  expect(report.hold).toBeGreaterThanOrEqual(video.duration - 1e-8);
  expect(new Set(report.captures).size).toBe(3);
  for (const [index, pixel] of report.pixels.entries()) {
    pixel.forEach((channel, channelIndex) => expect(Math.abs(channel - colors[index]![channelIndex]!)).toBeLessThan(12));
  }
  for (const frame of report.revisited) expect(frame.capture).toBe(report.captures[report.times.indexOf(frame.time)]);
  expect(report.audio, 'Importing a video must not replace the selected soundtrack').toBeNull();
  for (const index of [1, 0, 2]) {
    await page.evaluate(time => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(time), report.times[index]!);
    await expect.poll(async () => {
      const screenshot = await page.locator('.stage canvas').screenshot();
      return page.evaluate(async ({ encoded, expected }) => {
        const bitmap = new Image(); bitmap.src = `data:image/png;base64,${encoded}`; await bitmap.decode();
        const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0, 144, 256);
        const pixel = context.getImageData(72, 128, 1, 1).data;
        return expected.every((channel, channelIndex) => Math.abs(channel - pixel[channelIndex]!) < 12);
      }, { encoded: screenshot.toString('base64'), expected: colors[index]! });
    }, { message: 'Seeking the actual preview must paint the decoded video frame' }).toBe(true);
  }
  diagnostics.verify();
});

test('moves mixed media before or after the text without remixing and restores the original timeline on removal', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await filmSpec(page);
  const photo = await photoFixture(page), video = await videoFixture(page);
  await page.locator('.image-file').setInputFiles([photo, video]);
  await waitForMedia(page, 2);
  const after = await filmSpec(page);
  expect(after.objects).toEqual(original.objects);
  await choosePlacement(page, 'before');
  const before = await filmSpec(page);
  expect(before.seed).toBe(original.seed);
  expect(before.themeId).toBe(original.themeId);
  expect(before.sourceText).toBe(original.sourceText);
  expect(before.finalImages!.map(image => image.asset)).toEqual(after.finalImages!.map(image => image.asset));
  expect(before.finalImages![0]!.entrance.start).toBe(0);
  const firstTextStart = Math.min(...before.objects.map(object => object.entrance?.start ?? object.readingInterval[0]));
  expect(firstTextStart).toBeGreaterThanOrEqual(before.finalImages!.at(-1)!.exit.end);
  await choosePlacement(page, 'after');
  expect(await filmSpec(page)).toEqual(after);
  await choosePlacement(page, 'before');
  await page.locator('[data-locale="fr"]').click();
  expect(await filmSpec(page)).toEqual(before);
  await expect(page.locator('.image-placement [data-media-placement="before"]:visible').first()).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const time = dev.spec.finalImages![1]!.entrance.end + 0.55;
    dev.seek(time);
    await dev.renderer.renderFrameAsync(time);
  });
  const desktopScreenshot = testInfo.outputPath('media-before-desktop.png');
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  await testInfo.attach('media-before-desktop', { path: desktopScreenshot, contentType: 'image/png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('.image-placement [data-media-placement="before"]:visible').first()).toBeVisible();
  await expect(page.locator('.image-placement [data-media-placement="after"]:visible').first()).toBeVisible();
  const mobileScreenshot = testInfo.outputPath('media-before-mobile.png');
  await page.screenshot({ path: mobileScreenshot, fullPage: true });
  await testInfo.attach('media-before-mobile', { path: mobileScreenshot, contentType: 'image/png' });
  await page.locator('.image-remove-button[data-image-index="1"]:visible').first().click();
  await waitForMedia(page, 1);
  await expect(page.locator('.studio')).toHaveAttribute('data-media-placement', 'before');
  await page.locator('.image-remove-button[data-image-index="0"]:visible').first().click();
  await waitForMedia(page, 0);
  await expect(page.locator('.image-placement:visible')).toHaveCount(0);
  expect(await filmSpec(page)).toEqual(original);
  await page.locator('.image-file').setInputFiles(photo);
  await waitForMedia(page, 1);
  await expect(page.locator('.studio')).toHaveAttribute('data-media-placement', 'before');
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await filmSpec(page);
  expect(remixed.seed).not.toBe(original.seed);
  expect(remixed.finalImages![0]!.asset).toEqual(before.finalImages![0]!.asset);
  expect(remixed.finalImages![0]!.entrance.start).toBe(0);
  await page.locator('.edit-button').click();
  await createAndPause(page);
  expect((await filmSpec(page)).finalImages![0]!.entrance.start).toBe(0);
  await expect(page.locator('.studio')).toHaveAttribute('data-media-placement', 'before');
  diagnostics.verify();
});

test('rejects broken videos, disables media controls during export, and exports the animated preview frames', async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('.image-file').setInputFiles(await videoFixture(page, true));
  await waitForMedia(page, 1);
  await choosePlacement(page, 'before');
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(0.9));
  const kept = await filmSpec(page);
  await page.locator('.image-file').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video') });
  await expect(page.locator('.message')).toContainText(/could not be read|video/i);
  await expect(page.locator('.stage')).toHaveAttribute('aria-busy', 'false');
  expect(await filmSpec(page)).toEqual(kept);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.download-button')).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await expect(page.locator('.image-file')).toBeDisabled();
  for (const control of await page.locator('.image-placement button:visible, .image-remove-button:visible, .image-film-button:visible').all()) {
    await expect(control).toBeDisabled();
  }
  const download = await downloaded;
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))])), formats: [media.MP4, media.WEBM] });
    const size = dev.renderer.getSize(), previousTime = dev.renderer.lastTime;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The exported film has no video track.');
      const image = dev.spec.finalImages![0]!;
      const times = [0.15, 0.55, 0.95].map(offset => Math.round((image.entrance.end + offset) * 30) / 30);
      dev.renderer.resize(await track.getDisplayWidth(), await track.getDisplayHeight());
      const preview = document.createElement('canvas'), decoded = document.createElement('canvas');
      preview.width = decoded.width = 144; preview.height = decoded.height = 256;
      const a = preview.getContext('2d', { willReadFrequently: true })!, b = decoded.getContext('2d', { willReadFrequently: true })!;
      const sink = new media.VideoSampleSink(track), frames = [];
      for (const time of times) {
        const sample = await sink.getSample(time + 0.0006);
        if (!sample) throw new Error('An exported video frame is missing.');
        try {
          await dev.renderer.renderFrameAsync(time);
          a.drawImage(dev.renderer.canvas, 0, 0, 144, 256); sample.draw(b, 0, 0, 144, 256);
          const reference = a.getImageData(0, 0, 144, 256).data, actual = b.getImageData(0, 0, 144, 256).data;
          let difference = 0;
          for (let index = 0; index < actual.length; index += 4) {
            for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual[index + channel]! - reference[index + channel]!);
          }
          frames.push({ difference: difference / (144 * 256 * 3), color: [...b.getImageData(72, 128, 1, 1).data].slice(0, 3) });
        } finally { sample.close(); }
      }
      return { frames, audioTracks: (await input.getAudioTracks()).length, duration: await input.computeDuration(), expectedDuration: Math.ceil(dev.spec.duration * 30) / 30 };
    } finally { input.dispose(); dev.renderer.resize(...size); await dev.renderer.renderFrameAsync(previousTime); }
  }, bytes.toString('base64'));
  expect(report.duration).toBeCloseTo(report.expectedDuration, 3);
  expect(report.audioTracks, 'The original clip audio must stay silent in the exported film').toBe(0);
  for (const [index, frame] of report.frames.entries()) {
    expect(frame.difference).toBeLessThan(3);
    frame.color.forEach((channel, channelIndex) => expect(Math.abs(channel - colors[index]![channelIndex]!)).toBeLessThan(20));
  }
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('.image-file')).toBeEnabled();
  await expect(page.locator('.image-placement button:visible').first()).toBeEnabled();
  expect(await filmSpec(page)).toEqual(kept);
  diagnostics.verify();
});

test('recovers playback after removing a video whose decoder failed', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await filmSpec(page);
  await page.locator('.image-file').setInputFiles(await videoFixture(page));
  await waitForMedia(page, 1);
  await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.renderer.onMediaError?.(new Error('Simulated decoder failure'));
  });
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'error');
  await page.locator('.image-remove-button[data-image-index="0"]:visible').first().click();
  await waitForMedia(page, 0);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await filmSpec(page)).toEqual(original);
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('.download-button')).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(1000);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});
