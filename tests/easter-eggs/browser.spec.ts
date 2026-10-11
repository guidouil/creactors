import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { SceneSpec, EvaluatedScene } from '../../src/scene/types';
import type { SceneRenderer } from '../../src/scene/renderer';
import type { InputLanguage } from '../../src/text/director';

interface DebugApi {
  ready: Promise<void>;
  spec: SceneSpec;
  renderer: SceneRenderer;
  generate(text: string, seed?: number, language?: InputLanguage): Promise<SceneSpec>;
  seek(time: number): void;
  state(): EvaluatedScene;
  bounds(): { id: string; min: number[]; max: number[] }[];
}

type DebugWindow = Window & {
  __CREACTORS_DEV__: DebugApi;
  __EGG_QA_RELEASE__?: () => void;
};

test.beforeAll(async () => { await mkdir('artifacts/easter-eggs', { recursive: true }); });

const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

async function openStudio(page: Page) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      if (url.searchParams.has('api_key')) url.searchParams.set('api_key', '[redacted]');
      externalRequests.push(url.toString());
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__?.ready));
  await page.evaluate(async () => { await (window as unknown as DebugWindow).__CREACTORS_DEV__.ready; });
  await page.locator('[data-locale="fr"]').click();
  await expect(page.locator('.stage canvas')).toBeVisible();
  return () => {
    expect(errors, 'The hidden scenes must not cause uncaught browser errors').toEqual([]);
    expect(externalRequests, 'Discoveries must remain available offline').toEqual([]);
  };
}

async function repeatClick(page: Page, selector: string, count: number) {
  for (let index = 0; index < count; index++) await page.locator(selector).click();
}

async function closeEgg(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('.egg-overlay')).toBeHidden({ timeout: 6000 });
  await expect(page.locator('#studio-secrets')).toBeHidden();
}

async function pressCode(page: Page) {
  for (const key of konami) await page.keyboard.press(key);
}

async function generate(page: Page, text = 'Make it happen.', seed = 123) {
  return page.evaluate(async ({ text, seed }) => {
    return (window as unknown as DebugWindow).__CREACTORS_DEV__.generate(text, seed);
  }, { text, seed });
}

test('reveals the logo and credits without replacing the quotation or the generated film', async ({ page }) => {
  const verify = await openStudio(page);
  const input = await page.locator('.quote-input').inputValue();
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await expect(page.locator('.egg-collection-button')).toBeHidden();
  await repeatClick(page, '.brand-name', 4);
  await expect(page.locator('.egg-overlay')).toBeHidden();
  await repeatClick(page, '.brand-name', 1);
  await expect(page.locator('.egg-overlay')).toBeVisible();
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'falling');
  await expect(page.locator('.egg-collection-button')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/easter-eggs/logo-desktop.png', fullPage: true });
  await closeEgg(page);
  await repeatClick(page, '.footer-index', 3);
  await expect(page.locator('#studio-secrets')).toBeVisible();
  await expect(page.locator('#studio-secrets')).toHaveAttribute('data-view', 'credits');
  await expect(page.locator('#studio-secrets')).toContainText(/lettres|words/i);
  await expect(page.locator('.quote-input')).toHaveValue(input);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  await closeEgg(page);
  verify();
});

test('keeps normal dice and remix clicks working while consuming their long presses', async ({ page }) => {
  const verify = await openStudio(page);
  const originalQuote = await page.locator('.quote-input').inputValue();
  await page.locator('.example-button').click({ delay: 850 });
  await expect(page.locator('#studio-secrets')).toBeVisible();
  await expect(page.locator('#studio-secrets')).toHaveAttribute('data-view', 'seventh-die');
  await expect(page.locator('.quote-input')).toHaveValue(originalQuote);
  await closeEgg(page);
  await page.locator('.example-button').click();
  await expect(page.locator('.quote-input')).not.toHaveValue(originalQuote);
  await expect(page.locator('.egg-overlay')).toBeHidden();
  const originalFilm = await generate(page);
  await page.locator('.remix-button').click({ delay: 850 });
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'bloopers');
  await page.screenshot({ path: 'artifacts/easter-eggs/bloopers-desktop.png', fullPage: true });
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(originalFilm);
  await closeEgg(page);
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  const remixed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(remixed.seed).not.toBe(originalFilm.seed);
  expect(remixed.sourceText).toBe(originalFilm.sourceText);
  verify();
});

test('supports keyboard discoveries without hijacking text entry and translates the collection', async ({ page }) => {
  const verify = await openStudio(page);
  await page.locator('.quote-input').fill('Mon brouillon.');
  await pressCode(page);
  await expect(page.locator('.egg-overlay')).toBeHidden();
  await expect(page.locator('.egg-collection-button')).toBeHidden();
  await page.locator('.brand').focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'after-hours');
  await closeEgg(page);
  await page.locator('.brand').focus();
  await pressCode(page);
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'constellation');
  await closeEgg(page);
  await page.locator('.egg-collection-button').click();
  await expect(page.locator('#studio-secrets')).toBeVisible();
  await expect(page.locator('.egg-collection [data-found="true"]')).toHaveCount(2);
  await expect(page.locator('.egg-collection [data-secret-id]')).toHaveCount(20);
  await page.keyboard.press('Escape');
  await expect(page.locator('.egg-collection-button')).toBeFocused();
  await page.locator('[data-locale="en"]').click();
  await page.locator('.egg-collection-button').click();
  await expect(page.locator('#studio-secrets')).toContainText(/secrets|discover/i);
  await expect(page.locator('.egg-collection [data-found="true"]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  verify();
});

test('offers the seventh-face phrase explicitly and creates its shareable secret film', async ({ page }) => {
  const verify = await openStudio(page);
  const original = await page.locator('.quote-input').inputValue();
  await page.locator('.example-button').focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('#studio-secrets')).toBeVisible();
  await expect(page.locator('#studio-secrets')).toHaveAttribute('data-view', 'seventh-die');
  await expect(page.locator('.quote-input')).toHaveValue(original);
  await page.locator('.egg-load-phrase').click();
  await expect(page.locator('.quote-input')).toHaveValue('Même le hasard cache quelque chose.');
  await expect(page.locator('.egg-overlay')).toBeHidden();
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.secretFilm)).toBe('seventh-face');
  await expect(page.locator('.egg-collection-button')).toBeVisible();
  verify();
});

test('freezes hidden gestures during preparation and resumes them once the film is ready', async ({ page }) => {
  const verify = await openStudio(page);
  await page.locator('.quote-input').fill('Make it happen.');
  await page.evaluate(() => {
    const target = window as unknown as DebugWindow;
    const renderer = target.__CREACTORS_DEV__.renderer;
    const original = renderer.prepare.bind(renderer);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    renderer.prepare = async spec => { await blocked; return original(spec); };
    target.__EGG_QA_RELEASE__ = () => { renderer.prepare = original; release(); };
  });
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'preparing');
  await repeatClick(page, '.brand-name', 5);
  await repeatClick(page, '.footer-index', 3);
  await page.locator('.brand').focus();
  await page.keyboard.press('Shift+Enter');
  await pressCode(page);
  await expect(page.locator('.egg-overlay')).toBeHidden();
  await expect(page.locator('.egg-collection-button')).toBeHidden();
  await expect(page.locator('.quote-input')).toHaveValue('Make it happen.');
  await page.evaluate(() => (window as unknown as DebugWindow).__EGG_QA_RELEASE__!());
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.brand').focus();
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'after-hours');
  await closeEgg(page);
  verify();
});

test('freezes hidden gestures during export and keeps cancellation available', async ({ page }) => {
  const verify = await openStudio(page);
  await generate(page);
  await page.evaluate(async () => {
    const exporterUrl = `${location.origin}/src/export/video-exporter.ts`;
    const { VideoExporter } = await import(exporterUrl) as typeof import('../../src/export/video-exporter');
    const original = VideoExporter.prototype.export;
    VideoExporter.prototype.export = async (_renderer, _spec, options = {}) => {
      return new Promise<Awaited<ReturnType<typeof original>>>((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => {
          VideoExporter.prototype.export = original;
          reject(new DOMException('Export cancelled by the user', 'AbortError'));
        }, { once: true });
      });
    };
  });
  await page.locator('.download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await repeatClick(page, '.brand-name', 5);
  await repeatClick(page, '.footer-index', 3);
  await page.locator('.brand').focus();
  await pressCode(page);
  await expect(page.locator('.egg-overlay')).toBeHidden();
  await expect(page.locator('.egg-collection-button')).toBeHidden();
  await page.locator('.cancel-export-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('.message')).toBeVisible();
  verify();
});

test('keeps mobile discoveries and the collection visible with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const verify = await openStudio(page);
  await page.locator('.brand-mark').click({ delay: 850 });
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'after-hours');
  await expect(page.locator('.egg-overlay')).toBeVisible();
  await page.screenshot({ path: 'artifacts/easter-eggs/after-hours-mobile.png', fullPage: true });
  const moving = await page.locator('.egg-overlay').evaluate(overlay => overlay.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
  expect(moving, 'The static reduced-motion discovery should not keep animating').toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await closeEgg(page);
  await page.locator('.egg-collection-button').click();
  await expect(page.locator('#studio-secrets')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const dialogBounds = await page.locator('#studio-secrets').boundingBox();
  expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: 'artifacts/easter-eggs/collection-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  verify();
});

test('renders all six secret films with repeatable seeds, original text, and settled reading holds', async ({ page }) => {
  const verify = await openStudio(page);
  const phrases = [
    ['gravity', 'La gravité est une suggestion.'],
    ['boomerang', 'Les mots reviennent toujours.'],
    ['vertigo', 'Les mots ont le vertige.'],
    ['tunnel', 'Il y a un monde derrière les lettres.'],
    ['supernova', 'Une petite phrase peut devenir une supernova.'],
    ['seventh-face', 'Même le hasard cache quelque chose.'],
  ] as const;
  for (const [id, text] of phrases) {
    const first = await generate(page, text, 771);
    expect(first.secretFilm).toBe(id);
    expect(first.sourceText).toBe(text);
    expect(first.objects.map(object => object.text).join('')).toBe(text);
    const second = await generate(page, text, 771);
    expect(second).toEqual(first);
    const settled = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      const holds = dev.spec.cameraTracks.filter(track => track.primitive === 'HOLD' && track.end - track.start > 0.15);
      return holds.map(track => {
        dev.seek(track.start + 0.05);
        const before = dev.state();
        dev.seek(track.end - 0.05);
        const after = dev.state();
        return { before: before.camera, after: after.camera };
      });
    });
    expect(settled.length).toBeGreaterThan(0);
    for (const hold of settled) {
      expect(hold.after.fov).toBe(hold.before.fov);
      hold.after.position.forEach((value, index) => expect(value).toBeCloseTo(hold.before.position[index]!, 12));
      hold.after.quaternion.forEach((value, index) => expect(value).toBeCloseTo(hold.before.quaternion[index]!, 12));
    }
    await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      dev.seek(dev.spec.posterTime ?? dev.spec.duration - 1);
    });
    await page.locator('.stage').screenshot({ path: `artifacts/easter-eggs/${id}-poster.png` });
  }
  await page.locator('.egg-collection-button').click();
  for (const [id] of phrases) await expect(page.locator(`.egg-collection [data-secret-id="${id}"]`)).toHaveAttribute('data-found', 'true');
  await page.keyboard.press('Escape');
  verify();
});

test('retains a secret choreography when a local photo ending is appended', async ({ page }) => {
  const verify = await openStudio(page);
  const base = await generate(page, 'La gravité est une suggestion.', 771);
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ef6749'; context.fillRect(0, 0, 160, 120);
    context.fillStyle = '#162746'; context.fillRect(20, 20, 120, 80);
    context.fillStyle = '#ef6749'; context.font = 'bold 40px sans-serif'; context.fillText('7', 68, 75);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.locator('.image-file').setInputFiles({ name: 'secret-photo.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.stage')).toHaveAttribute('aria-busy', 'false');
  const appended = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(dev.spec.posterTime!);
    return { spec: dev.spec, frame: dev.state(), bounds: dev.bounds() };
  });
  expect(appended.spec.secretFilm).toBe('gravity');
  expect(appended.spec.objects).toEqual(base.objects);
  expect(appended.spec.sourceText).toBe(base.sourceText);
  expect(appended.spec.duration).toBeGreaterThan(base.duration);
  expect(appended.frame.finalImages![0]!.visible).toBe(true);
  const photo = appended.bounds.find(item => item.id === appended.spec.finalImages![0]!.id)!;
  expect(photo.min[0]).toBeGreaterThan(-1); expect(photo.max[0]).toBeLessThan(1);
  expect(photo.min[1]).toBeGreaterThan(-1); expect(photo.max[1]).toBeLessThan(1);
  await page.locator('.stage').screenshot({ path: 'artifacts/easter-eggs/gravity-photo-ending.png' });
  verify();
});

test('returns a mobile creator to the input when reloading a discovered film phrase', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const verify = await openStudio(page);
  await page.locator('.quote-input').fill('La gravité est une suggestion.');
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await expect(page.locator('.quote-input')).toBeHidden();
  await page.locator('.egg-collection-button').click();
  await expect(page.locator('#studio-secrets')).toBeVisible();
  await page.locator('[data-film-phrase="gravity"]').click();
  await expect(page.locator('#studio-secrets')).toBeHidden();
  await expect(page.locator('.quote-input')).toBeVisible();
  await expect(page.locator('.quote-input')).toBeFocused();
  await expect(page.locator('.quote-input')).toHaveValue('La gravité est une suggestion.');
  await expect(page.locator('.quote-input')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.create-button')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  await page.screenshot({ path: 'artifacts/easter-eggs/reloaded-phrase-mobile.png', fullPage: true });
  verify();
});

test('reveals the remaining studio gestures without changing playback, colours, or audio', async ({ page }) => {
  const verify = await openStudio(page);
  await generate(page);
  const original = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(2);
    return { spec: dev.spec, frame: dev.state() };
  });
  const gestures = [
    ['.replay-button', 'rewind'],
    ['[data-theme="acid"]', 'acid-rain'],
    ['[data-theme="monochrome"]', 'silent-film'],
    ['[data-theme="cobalt"]', 'cobalt'],
    ['[data-theme="orchid"]', 'orchid'],
    ['[data-theme="coral-night"]', 'coral'],
    ['.audio-button', 'orchestra'],
  ] as const;
  for (const [selector, effect] of gestures) {
    await page.locator(selector).focus();
    await page.keyboard.press('Shift+Enter');
    await expect(page.locator('.egg-overlay')).toBeVisible();
    await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', effect);
    await closeEgg(page);
    const current = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return { spec: dev.spec, frame: dev.state() };
    });
    expect(current).toEqual(original);
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('.audio-button')).toHaveAttribute('aria-expanded', 'false');
  }
  await repeatClick(page, '.timecode', 3);
  await expect(page.locator('.egg-overlay')).toHaveAttribute('data-effect', 'answer42');
  await closeEgg(page);
  await page.locator('.egg-collection-button').click();
  await expect(page.locator('.egg-collection [data-found="true"]')).toHaveCount(8);
  await page.keyboard.press('Escape');
  verify();
});
