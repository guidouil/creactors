import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SceneSpec } from '../../src/scene/types';
import type { SceneRenderer } from '../../src/scene/renderer';

interface DebugApi {
  ready: Promise<void>;
  spec: SceneSpec;
  renderer: SceneRenderer;
  seek(time: number): void;
  bounds(): { id: string; min: number[]; max: number[] }[];
}
type DebugWindow = Window & { __CREACTORS_DEV__: DebugApi };

async function openStudio(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__?.ready));
  await page.evaluate(async () => { await (window as unknown as DebugWindow).__CREACTORS_DEV__.ready; });
  await page.locator('[data-locale="en"]').click();
  return { verify() { expect(errors).toEqual([]); } };
}

async function selectFormat(page: Page, format: 'vertical' | 'square') {
  await page.locator(`[data-film-format="${format}"]`).click();
  await expect(page.locator(`[data-film-format="${format}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-film-format="${format}"]`)).toBeEnabled();
}

async function createAndPause(page: Page) {
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
}

async function photoFixture(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e05040'; context.fillRect(0, 0, 60, 80);
    context.fillStyle = '#30c090'; context.fillRect(60, 0, 60, 80);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  return { name: 'landscape.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

test('selects square by keyboard before CREATE while retaining the draft, font and pending media', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await expect(page.locator('[data-film-format="vertical"]')).toHaveAttribute('aria-pressed', 'true');
  const draft = 'Une idée claire mérite une belle forme.';
  await page.locator('.quote-input').fill(draft);
  await page.locator('.font-editor-button').click();
  await page.locator('[data-font-id="bungee"]').click();
  await page.locator('.image-file').setInputFiles(await photoFixture(page));
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const button = page.locator('[data-film-format="square"]');
  await button.focus();
  await button.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  await expect(page.locator('.quote-input')).toHaveValue(draft);
  await expect(page.locator('.quote-input')).toHaveCSS('font-family', /CREACTORS Block/);
  expect(await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { aspect: dev.spec.aspect, media: dev.spec.finalImages?.length ?? 0, size: dev.renderer.getSize() };
  })).toEqual({ aspect: 1, media: 0, size: [540, 540] });
  await createAndPause(page);
  const film = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(film.aspect).toBe(1);
  expect(film.sourceText).toBe(draft);
  expect(film.fontId).toBe('bungee');
  expect(film.finalImages?.map(image => image.asset.name)).toEqual(['landscape.png']);
  diagnostics.verify();
});

test('recomposes a film in square, preserves its choices and draft, and keeps square through REMIX and font changes', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = 'A clear message travels further.';
  await page.locator('.quote-input').fill(text);
  await page.locator('.image-file').setInputFiles(await photoFixture(page));
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await createAndPause(page);
  const before = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.edit-button').click();
  const draft = 'Keep this unfinished draft.';
  await page.locator('.quote-input').fill(draft);
  await selectFormat(page, 'square');
  const square = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(square.aspect).toBe(1);
  expect(square.seed).toBe(before.seed);
  expect(square.themeId).toBe(before.themeId);
  expect(square.sourceText).toBe(before.sourceText);
  expect(square.fontId).toBe(before.fontId);
  expect(square.finalImages?.map(image => image.asset.source)).toEqual(before.finalImages?.map(image => image.asset.source));
  expect(square.cameraTracks).not.toEqual(before.cameraTracks);
  await expect(page.locator('.quote-input')).toHaveValue(draft);
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remix = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(remix.aspect).toBe(1);
  expect(remix.seed).not.toBe(square.seed);
  expect(remix.themeId).toBe(square.themeId);
  expect(remix.finalImages?.map(image => image.asset.source)).toEqual(square.finalImages?.map(image => image.asset.source));
  for (const fontId of ['montserrat-bold', 'press-start-2p', 'bungee']) {
    await page.locator('.font-film-button').click();
    await page.locator(`[data-font-id="${fontId}"]`).click();
    await expect(page.locator('#font-picker')).not.toBeVisible();
    const report = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return { font: dev.spec.fontId, aspect: dev.spec.aspect, bounds: dev.spec.objects.map(object => {
        dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
        return dev.bounds().find(box => box.id === object.id)!;
      }) };
    });
    expect(report.font).toBe(fontId);
    expect(report.aspect).toBe(1);
    for (const box of report.bounds) {
      expect(box.min[0], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[0], `${fontId} ${box.id}`).toBeLessThan(0.9);
      expect(box.min[1], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[1], `${fontId} ${box.id}`).toBeLessThan(0.9);
    }
  }
  await selectFormat(page, 'vertical');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.getSize())).toEqual([540, 960]);
  diagnostics.verify();
});

test('fits square preview, format choices and playback on a small phone in both languages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make words move.');
  await selectFormat(page, 'square');
  await createAndPause(page);
  for (const locale of ['fr', 'en']) {
    await page.locator(`[data-locale="${locale}"]`).click();
    await expect(page.locator('[data-film-format="square"]')).toContainText(locale === 'fr' ? 'Carré' : 'Square');
    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      const playback = document.querySelector('.playback')!.getBoundingClientRect();
      const choices = [...document.querySelectorAll('[data-film-format]')].map(button => {
        const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height, top: rect.top };
      });
      return { ratio: stage.width / stage.height, stageBottom: stage.bottom, playbackBottom: playback.bottom, choices, scrollWidth: document.documentElement.scrollWidth, viewport: { width: innerWidth, height: innerHeight } };
    });
    expect(layout.ratio).toBeCloseTo(1, 3);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width);
    expect(layout.playbackBottom).toBeLessThanOrEqual(layout.viewport.height);
    for (const choice of layout.choices) {
      expect(choice.width).toBeGreaterThanOrEqual(44);
      expect(choice.height).toBeGreaterThanOrEqual(44);
      expect(choice.top).toBeGreaterThanOrEqual(0);
    }
  }
  const spec = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.evaluate(time => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(time), spec.posterTime ?? 2);
  await page.screenshot({ path: testInfo.outputPath('square-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('square-desktop.png'), fullPage: true });
  diagnostics.verify();
});

test('restores the previous film and draft after failed square preparation, then allows another attempt', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Keep this film available.');
  await createAndPause(page);
  const previous = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.edit-button').click();
  await page.locator('.quote-input').fill('Unfinished words.');
  await page.evaluate(() => {
    const renderer = (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer;
    const prepare = renderer.prepare.bind(renderer);
    let rejected = false;
    renderer.prepare = async spec => {
      await prepare(spec);
      if (spec.aspect === 1 && !rejected) { rejected = true; throw new Error('Simulated square preparation failure.'); }
    };
  });
  await page.locator('[data-film-format="square"]').click();
  await expect(page.locator('.message')).toContainText('could not be prepared');
  await expect(page.locator('[data-film-format="vertical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-film-format="square"]')).toBeEnabled();
  await expect(page.locator('.quote-input')).toHaveValue('Unfinished words.');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(previous);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.getSize())).toEqual([540, 960]);
  await selectFormat(page, 'square');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.aspect)).toBe(1);
  diagnostics.verify();
});

test('retains the renderer error after context loss during format preparation and recovers the original film', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Recover this film.');
  await createAndPause(page);
  const previous = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.evaluate(() => {
    const renderer = (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer;
    const prepare = renderer.prepare.bind(renderer);
    let interrupted = false;
    renderer.prepare = async spec => {
      await prepare(spec);
      if (spec.aspect === 1 && !interrupted) {
        interrupted = true;
        renderer.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      }
    };
  });
  await page.locator('[data-film-format="square"]').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-film-format="vertical"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(previous);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.canvas.dispatchEvent(new Event('webglcontextrestored')));
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await selectFormat(page, 'square');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.aspect)).toBe(1);
  diagnostics.verify();
});

test('keeps a square reduced-motion welcome and generated poster paused', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('A calm square poster.');
  await selectFormat(page, 'square');
  const welcome = await page.locator('.stage canvas').screenshot();
  await page.waitForTimeout(150);
  expect(await page.locator('.stage canvas').screenshot()).toEqual(welcome);
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await selectFormat(page, 'vertical');
  await selectFormat(page, 'square');
  const film = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { aspect: dev.spec.aspect, time: dev.renderer.lastTime, posterTime: dev.spec.posterTime };
  });
  expect(film.aspect).toBe(1);
  expect(film.time).toBe(film.posterTime);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});

test('allows a square export after a capability failure in the other format', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Go.');
  await createAndPause(page);
  await page.evaluate(() => {
    const encoder = globalThis.VideoEncoder;
    Object.assign(window, { restoreEncoder() { globalThis.VideoEncoder = encoder; } });
    Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, writable: true, value: undefined });
  });
  await page.locator('.download-button').click();
  await expect(page.locator('.download-button')).toBeDisabled();
  await page.evaluate(() => (window as unknown as { restoreEncoder(): void }).restoreEncoder());
  await selectFormat(page, 'square');
  await expect(page.locator('.download-button')).toBeEnabled();
  diagnostics.verify();
});

test('downloads native square video with matching decoded frames and restores the square preview', async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Go.');
  await selectFormat(page, 'square');
  await createAndPause(page);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(1));
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  await expect(page.locator('[data-film-format="square"]')).toBeDisabled();
  await expect(page.locator('[data-film-format="vertical"]')).toBeDisabled();
  const download = await downloaded;
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))])), formats: media.ALL_FORMATS });
    const size = dev.renderer.getSize(), previousTime = dev.renderer.lastTime;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The square export has no video track.');
      const width = await track.getDisplayWidth(), height = await track.getDisplayHeight();
      dev.renderer.resize(width, height);
      const reference = document.createElement('canvas'), decoded = document.createElement('canvas');
      reference.width = reference.height = decoded.width = decoded.height = 144;
      const a = reference.getContext('2d', { willReadFrequently: true })!, b = decoded.getContext('2d', { willReadFrequently: true })!;
      const sink = new media.VideoSampleSink(track);
      const time = Math.round((dev.spec.objects[0]!.readingInterval[0] + dev.spec.objects[0]!.readingInterval[1]) / 2 * 30) / 30;
      const sample = await sink.getSample(time + 0.0006);
      if (!sample) throw new Error('A square export frame is missing.');
      try {
        dev.renderer.renderFrame(time); a.drawImage(dev.renderer.canvas, 0, 0, 144, 144); sample.draw(b, 0, 0, 144, 144);
        const preview = a.getImageData(0, 0, 144, 144).data, video = b.getImageData(0, 0, 144, 144).data;
        let difference = 0;
        for (let index = 0; index < video.length; index += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(video[index + channel]! - preview[index + channel]!);
        return { width, height, difference: difference / (144 * 144 * 3), duration: await input.computeDuration(), expectedDuration: Math.ceil(dev.spec.duration * 30) / 30 };
      } finally { sample.close(); }
    } finally { input.dispose(); dev.renderer.resize(...size); dev.renderer.renderFrame(previousTime); }
  }, bytes.toString('base64'));
  expect(report.width).toBe(report.height);
  expect([1080, 720]).toContain(report.width);
  expect(report.difference).toBeLessThan(3);
  expect(report.duration).toBeCloseTo(report.expectedDuration, 3);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { size: dev.renderer.getSize(), time: dev.renderer.lastTime };
  })).toEqual({ size: [540, 540], time: 1 });
  diagnostics.verify();
});
