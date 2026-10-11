import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { FUTURE_POSTER_TIME, FUTURE_QUOTE } from '../src/demos/future';
import { EXAMPLES } from '../src/app/examples';
import { videoFilename } from '../src/export/filename';
import type { EvaluatedScene, SceneSpec } from '../src/scene/types';
import type { SceneRenderer } from '../src/scene/renderer';
import type { InputLanguage, TextAnalysis } from '../src/text/director';
import type { AudioTrack } from '../src/audio/types';
import { builtinAudioTracks } from '../src/audio/choices';
import { getTheme, getThemeFamilyId, resolveTheme } from '../src/themes';
import { colorCycleGifFixture, disposalGifFixture, singleFrameGifFixture } from './fixtures/gif';

interface DebugApi {
  ready: Promise<void>;
  seek(time: number): void;
  capture(time: number): Promise<string>;
  spec: SceneSpec;
  state(): EvaluatedScene;
  metrics(): unknown;
  bounds(): { id: string; min: number[]; max: number[] }[];
  renderer: SceneRenderer;
  analysis: TextAnalysis | null;
  audio: AudioTrack | null;
  generate(text: string, seed?: number, language?: InputLanguage): Promise<SceneSpec>;
}

type DebugWindow = Window & { __CREACTORS_DEV__: DebugApi };

test('selects bundled fonts for the draft, 3D film and remixes with unclipped reading holds', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.font-editor-button').click();
  await expect(page.locator('#font-picker')).toBeVisible();
  await expect(page.locator('.font-options .font-option')).toHaveCount(8);
  await page.locator('#font-search').fill('pixel');
  await expect(page.locator('.font-options .font-option')).toHaveCount(1);
  await expect(page.locator('[data-font-id="press-start-2p"] .font-option-character')).toHaveText('8-bit');
  await page.locator('#font-search').fill('');
  await page.locator('[data-font-id="anton"]').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await expect(page.locator('.quote-input')).toHaveCSS('font-family', /Anton/);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(original.fontId).toBe('anton');
  for (const fontId of ['bungee', 'black-ops-one', 'alfa-slab-one', 'press-start-2p', 'bebas-neue', 'montserrat-bold', 'barlow-condensed-black']) {
    await page.locator('.font-film-button').click();
    await page.locator(`[data-font-id="${fontId}"]`).click();
    await expect(page.locator('#font-picker')).not.toBeVisible();
    const result = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return { spec: dev.spec, bounds: dev.spec.objects.map(object => {
        dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
        return dev.bounds().find(box => box.id === object.id)!;
      }) };
    });
    expect(result.spec.fontId ?? 'barlow-condensed-black').toBe(fontId);
    expect(result.spec.sourceText).toBe(original.sourceText);
    expect(result.spec.themeId).toBe(original.themeId);
    expect(result.spec.seed).toBe(original.seed);
    for (const box of result.bounds) {
      expect(box.min[0], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[0], `${fontId} ${box.id}`).toBeLessThan(0.9);
      expect(box.min[1], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[1], `${fontId} ${box.id}`).toBeLessThan(0.9);
    }
  }
  await page.locator('.font-film-button').click();
  await page.locator('[data-font-id="press-start-2p"]').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.fontId)).toBe('press-start-2p');
  diagnostics.verify();
});

test('automatically sizes display fonts on mobile without breaking wide French words', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const diagnostics = await openStudio(page);
  const text = 'L’imagination transforme les possibilités.';
  await page.locator('.quote-input').fill(text);
  const sizes: number[] = [];
  for (const fontId of ['bungee', 'black-ops-one', 'alfa-slab-one', 'press-start-2p']) {
    await page.locator('.font-editor-button').click();
    await page.locator(`[data-font-id="${fontId}"]`).click();
    await expect(page.locator('#font-picker')).not.toBeVisible();
    const inputFit = await page.locator('.quote-input').evaluate(input => {
      const style = getComputedStyle(input);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      context.letterSpacing = style.letterSpacing;
      return { size: parseFloat(style.fontSize), width: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        longest: Math.max(...(input as HTMLTextAreaElement).value.split(/\s+/u).map(word => context.measureText(word).width)) };
    });
    expect(inputFit.longest, fontId).toBeLessThanOrEqual(inputFit.width + 1);
    sizes.push(inputFit.size);
    await createAndPause(page);
    const result = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return { words: dev.spec.objects.flatMap(object => (object.displayText ?? object.text).split(/\s+/u)),
        bounds: dev.spec.objects.map(object => {
          dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
          return dev.bounds().find(box => box.id === object.id)!;
        }) };
    });
    expect(result.words).toEqual(text.split(/\s+/u));
    for (const box of result.bounds) {
      expect(box.min[0], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[0], `${fontId} ${box.id}`).toBeLessThan(0.9);
      expect(box.min[1], `${fontId} ${box.id}`).toBeGreaterThan(-0.9);
      expect(box.max[1], `${fontId} ${box.id}`).toBeLessThan(0.9);
    }
    await page.locator('.edit-button').click();
  }
  expect(new Set(sizes.map(size => Math.round(size * 100))).size).toBeGreaterThan(1);
  await page.locator('.quote-input').fill('EXTRAORDINAIREMENT');
  const fontSize = () => page.locator('.quote-input').evaluate(input => parseFloat(getComputedStyle(input).fontSize));
  await expect.poll(fontSize).toBeLessThan(sizes.at(-1)!);
  const reduced = await fontSize();
  await page.locator('.quote-input').fill('ÉTÉ');
  await expect.poll(fontSize).toBeGreaterThan(reduced);
  const mobileSize = await fontSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(fontSize).toBeGreaterThan(mobileSize);
  await page.locator('.quote-input').fill(text.repeat(20));
  await expect.poll(() => page.locator('.quote-input').evaluate(input => input.scrollHeight > input.clientHeight)).toBe(true);
  diagnostics.verify();
});

test('imports a local TTF for 3D text and keeps the current film after a rejected file', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('.font-film-button').click();
  await page.locator('.font-file').setInputFiles('assets/fonts/Anton-Regular.ttf');
  await expect(page.locator('#font-picker')).not.toBeVisible();
  const imported = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(imported.fontId).toMatch(/^local-/);
  const geometry = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return dev.spec.objects.map(object => {
      dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
      return dev.bounds().find(box => box.id === object.id)!;
    });
  });
  for (const box of geometry) expect(box.max[0] - box.min[0]).toBeGreaterThan(0.05);
  await page.locator('.font-film-button').click();
  await page.locator('.font-file').setInputFiles({ name: 'broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('not a font') });
  await expect(page.locator('.font-status')).not.toBeEmpty();
  await expect(page.locator('#font-picker')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(imported);
  await page.locator('.font-close').click();
  await expect(page.locator('.font-film-button')).toBeFocused();
  diagnostics.verify();
});

test('requests OS fonts only from an explicit click and recovers after access is refused', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { fontQueries: 0, async queryLocalFonts() {
      (window as unknown as { fontQueries: number }).fontQueries++;
      throw new DOMException('Access refused', 'NotAllowedError');
    } });
  });
  const diagnostics = await openStudio(page);
  await page.locator('.font-editor-button').click();
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(0);
  await page.locator('.font-device-button').click();
  await expect(page.locator('.font-status')).toContainText('Access to device fonts was not granted');
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(1);
  await page.locator('[data-font-id="anton"]').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await expect(page.locator('.quote-input')).toHaveCSS('font-family', /Anton/);
  diagnostics.verify();
});

test('keeps draft and film font choices independent while editing', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.edit-button').click();
  await page.locator('.quote-input').fill('Un nouveau brouillon.');
  await page.locator('.font-editor-button').click();
  await page.locator('[data-font-id="anton"]').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  await page.locator('.font-film-button').click();
  await page.locator('[data-font-id="montserrat-bold"]').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await expect(page.locator('.quote-input')).toHaveCSS('font-family', /Anton/);
  await expect(page.locator('.quote-input')).toHaveValue('Un nouveau brouillon.');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.fontId)).toBe('montserrat-bold');
  await createAndPause(page);
  const created = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(created.fontId).toBe('anton');
  expect(created.sourceText).toBe('Un nouveau brouillon.');
  diagnostics.verify();
});

test('loads a chosen OS font locally without requesting remote assets', async ({ page }) => {
  const fontBytes = [...await readFile('assets/fonts/Anton-Regular.ttf')];
  await page.addInitScript(bytes => {
    Object.assign(window, { async queryLocalFonts() {
      return [{ postscriptName: 'Anton-Regular', fullName: 'Anton Regular', family: 'Anton', style: 'Regular',
        async blob() { return new Blob([new Uint8Array(bytes)], { type: 'font/ttf' }); } }];
    } });
  }, fontBytes);
  const diagnostics = await openStudio(page);
  await page.locator('.font-editor-button').click();
  await page.locator('.font-device-button').click();
  await expect(page.locator('.font-device-options .font-option')).toHaveCount(1);
  await page.locator('.font-device-options .font-option').click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await createAndPause(page);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.fontId)).toMatch(/^local-/);
  diagnostics.verify();
});

for (const fontId of ['montserrat-bold', 'press-start-2p']) test(`exports the selected ${fontId} font with video frames matching the 3D preview`, async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make  words  move.');
  await page.locator('.font-editor-button').click();
  await page.locator(`[data-font-id="${fontId}"]`).click();
  await expect(page.locator('#font-picker')).not.toBeVisible();
  await createAndPause(page);
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  const bytes = await readFile((await download.path())!);
  const differences = await page.evaluate(async ({ encoded, mp4 }) => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))])), formats: [mp4 ? media.MP4 : media.WEBM] });
    const size = dev.renderer.getSize(), previousTime = dev.renderer.lastTime;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The font export has no video track.');
      dev.renderer.resize(await track.getDisplayWidth(), await track.getDisplayHeight());
      const reference = document.createElement('canvas'), decoded = document.createElement('canvas');
      reference.width = decoded.width = 144; reference.height = decoded.height = 256;
      const a = reference.getContext('2d', { willReadFrequently: true })!, b = decoded.getContext('2d', { willReadFrequently: true })!;
      const sink = new media.VideoSampleSink(track);
      const differences: number[] = [];
      for (const object of dev.spec.objects) {
        const time = Math.round((object.readingInterval[0] + object.readingInterval[1]) / 2 * 30) / 30;
        const sample = await sink.getSample(time + 0.0006);
        if (!sample) throw new Error('A selected-font frame is missing.');
        try {
          dev.renderer.renderFrame(time); a.drawImage(dev.renderer.canvas, 0, 0, 144, 256); sample.draw(b, 0, 0, 144, 256);
          const preview = a.getImageData(0, 0, 144, 256).data, video = b.getImageData(0, 0, 144, 256).data;
          let difference = 0;
          for (let index = 0; index < video.length; index += 4) for (let channel = 0; channel < 3; channel++) difference += Math.abs(video[index + channel]! - preview[index + channel]!);
          differences.push(difference / (144 * 256 * 3));
        } finally { sample.close(); }
      }
      return differences;
    } finally { input.dispose(); dev.renderer.resize(...size); dev.renderer.renderFrame(previousTime); }
  }, { encoded: bytes.toString('base64'), mp4: download.suggestedFilename().endsWith('.mp4') });
  expect(differences.length).toBeGreaterThan(1);
  for (const difference of differences) expect(difference).toBeLessThan(3);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.fontId)).toBe(fontId);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});

/** First second 440 Hz, then 880 Hz: verifies excerpt offset in decoded exports. */
function audioFixture(duration = 2.5): Buffer {
  const rate = 48000, samples = Math.round(duration * rate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    wav.writeInt16LE(Math.round(Math.sin(index / rate * Math.PI * 2 * (index < rate ? 440 : 880)) * 0.2 * 32767), 44 + index * 2);
  }
  return wav;
}

/** Four saturated corners make uncropped contain-fit visible in encoded frames. */
async function imageFixture(page: Page, width = 600, height = 400, mimeType = 'image/png'): Promise<Buffer> {
  const encoded = await page.evaluate(({ width, height, mimeType }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    for (const [color, x, y] of [
      ['#00ff00', 0, 0], ['#ff0000', width / 2, 0],
      ['#0000ff', 0, height / 2], ['#ffff00', width / 2, height / 2],
    ] as const) {
      context.fillStyle = color;
      context.fillRect(x, y, width / 2, height / 2);
    }
    return canvas.toDataURL(mimeType, 0.95).split(',')[1]!;
  }, { width, height, mimeType });
  return Buffer.from(encoded, 'base64');
}

async function openStudio(page: Page, keepExample = false, allowGiphy = false) {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (allowGiphy && (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com'))) return;
    if (/^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      if (url.searchParams.has('api_key')) url.searchParams.set('api_key', '[redacted]');
      externalRequests.push(url.toString());
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as DebugWindow).__CREACTORS_DEV__?.ready));
  await page.evaluate(async () => { await (window as unknown as DebugWindow).__CREACTORS_DEV__.ready; });
  await expect(page.locator('.stage canvas')).toBeVisible();
  // Existing choreography checks use an explicit fixture rather than a random example.
  if (!keepExample) await page.locator('.quote-input').fill(FUTURE_QUOTE);
  return {
    verify() {
      expect(errors, 'The renderer must finish without uncaught page errors').toEqual([]);
      expect(externalRequests, 'The application must not request remote fonts or runtime assets').toEqual([]);
    },
  };
}

interface GiphyMockRequest { query: string; offset: number; limit: number; trending: boolean }

function giphyFixture(id: string) {
  const url = `https://media.giphy.com/media/${id}/giphy.gif?cid=fixture&rid=giphy.gif`;
  const rendition = { url, width: '64', height: '64', size: String(colorCycleGifFixture().length) };
  return { type: 'gif', id, slug: id, url: `https://giphy.com/gifs/${id}`, title: `Fixture ${id}`, rating: 'g',
    source: 'https://giphy.com/fixtureartist', username: 'fixtureartist',
    user: { username: 'fixtureartist', display_name: 'Fixture Artist', profile_url: 'https://giphy.com/fixtureartist' },
    images: { original: rendition, downsized: rendition, fixed_width: rendition, fixed_height: rendition, fixed_height_small: rendition,
      fixed_width_still: rendition, fixed_height_still: rendition },
    analytics: {}, is_sticker: false };
}

/** Replace only the browser-facing test key; never read or log the real local key. */
async function mockGiphy(page: Page, configured = true) {
  const requests: GiphyMockRequest[] = [];
  const mediaLoads: string[] = [];
  let respond: ((request: GiphyMockRequest) => Promise<{ status: number; body: unknown }>) | null = null;
  await page.route(/\/src\/image\/giphy\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('import.meta.env.VITE_GIPHY_API_KEY', JSON.stringify(configured ? 'creactors-test-key' : ''));
    await route.fulfill({ response, body });
  });
  await page.route('https://api.giphy.com/**', async route => {
    const url = new URL(route.request().url());
    const request = { query: url.searchParams.get('q') ?? '', offset: Number(url.searchParams.get('offset') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 12), trending: url.pathname.endsWith('/trending') };
    requests.push(request);
    const result = respond ? await respond(request) : {
      status: 200,
      body: { data: Array.from({ length: request.offset ? 1 : request.limit }, (_, index) => giphyFixture(`${request.query || 'trending'}-${request.offset + index}`)),
        pagination: { offset: request.offset, count: request.offset ? 1 : request.limit, total_count: request.limit + 1 },
        meta: { status: 200, msg: 'OK', response_id: 'fixture-response' } },
    };
    // A close/new search can intentionally abort the obsolete request.
    await route.fulfill({ status: result.status, json: result.body, headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
  });
  await page.route('https://media.giphy.com/**', async route => {
    mediaLoads.push(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: 'image/gif', body: colorCycleGifFixture(), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://giphy-analytics.giphy.com/**', route => route.fulfill({ status: 204 }));
  return { requests, mediaLoads, respondWith(handler: typeof respond) { respond = handler; } };
}

test('keeps the GIPHY picker offline when unconfigured and preserves its local import on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  const mock = await mockGiphy(page, false);
  const diagnostics = await openStudio(page);
  expect(mock.requests).toEqual([]);
  const opener = page.locator('.image-editor-button');
  await opener.click();
  await expect(page.locator('.giphy-dialog')).toBeVisible();
  await expect(page.locator('.giphy-search-button')).toBeDisabled();
  await expect(page.locator('.giphy-local-button')).toBeEnabled();
  expect(mock.requests).toEqual([]);
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>('.giphy-dialog')!;
    return { focused: dialog.contains(document.activeElement), width: document.documentElement.scrollWidth,
      controls: [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && button.offsetParent !== null).map(button => {
        const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, right: box.right };
      }) };
  });
  expect(layout.focused).toBe(true);
  expect(layout.width).toBeLessThanOrEqual(320);
  for (const control of layout.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.right).toBeLessThanOrEqual(320);
  }
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.giphy-local-button').click();
  await (await chooser).setFiles({ name: 'local.gif', mimeType: 'image/gif', buffer: colorCycleGifFixture() });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  expect(mock.requests).toEqual([]);
  diagnostics.verify();
});

test('searches and paginates GIPHY only on demand, retains attribution, and appends GIFs to mixed endings', async ({ page }, testInfo) => {
  const mock = await mockGiphy(page);
  const diagnostics = await openStudio(page, false, true);
  expect(mock.requests, 'GIPHY must make no request when the studio initially opens').toEqual([]);
  await page.locator('.quote-input').fill('Make it happen.');
  await page.locator('.image-editor-button').click();
  await expect(page.locator('.giphy-dialog')).toBeVisible();
  await page.locator('.giphy-search-input').fill('cats');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result[data-giphy-id="cats-0"]')).toBeVisible();
  const first = mock.requests.find(request => request.query === 'cats' && request.offset === 0)!;
  expect(first).toBeDefined();
  await expect(page.locator('.giphy-result')).toHaveCount(first.limit);
  await expect(page.locator('.giphy-brand')).toHaveAccessibleName(/powered by giphy/i);
  await expect(page.locator('.giphy-result-card').first()).toContainText('Fixture Artist');
  await page.screenshot({ path: testInfo.outputPath('giphy-desktop.png'), fullPage: true });
  await page.locator('.giphy-more-button').click();
  await expect(page.locator('.giphy-result')).toHaveCount(first.limit + 1);
  expect(mock.requests.filter(request => request.query === 'cats').map(request => request.offset)).toEqual([0, first.limit]);
  await page.locator('.giphy-result[data-giphy-id="cats-0"]').click();
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  await createAndPause(page);
  const firstAsset = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.finalImages![0]!.asset);
  expect(firstAsset.animation!.frames).toHaveLength(3);
  expect(firstAsset.animation!.duration).toBe(1);
  expect(JSON.stringify(firstAsset)).toContain('Fixture Artist');
  expect(JSON.stringify(firstAsset)).toContain('https://giphy.com/fixtureartist');
  await page.locator('.image-file').setInputFiles({ name: 'middle.png', mimeType: 'image/png', buffer: await imageFixture(page, 64, 64) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '2');
  await page.locator('.image-film-button').click();
  await page.locator('.giphy-search-input').fill('dogs');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result[data-giphy-id="dogs-0"]')).toBeVisible();
  await page.locator('.giphy-result[data-giphy-id="dogs-0"]').click();
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '3');
  const report = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const image = dev.spec.finalImages![2]!, time = image.entrance.end + 0.35;
    const capture = await dev.capture(time);
    dev.seek(dev.spec.duration); dev.seek(0);
    const revisited = await dev.capture(time);
    const bitmap = new Image(); bitmap.src = capture; await bitmap.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    return { spec: dev.spec, capture, revisited, color: [...context.getImageData(540, 960, 1, 1).data].slice(0, 3) };
  });
  expect(report.spec.finalImages!.map(image => Boolean(image.asset.animation))).toEqual([true, false, true]);
  expect(report.spec.finalImages![1]!.asset.name).toBe('middle.png');
  expect(report.capture).toBe(report.revisited);
  expect(report.color).toEqual([0, 255, 0]);
  expect(mock.mediaLoads.some(path => path.includes('cats-0'))).toBe(true);
  expect(mock.mediaLoads.some(path => path.includes('dogs-0'))).toBe(true);
  diagnostics.verify();
});

test('recovers from a GIPHY search failure and ignores a late response after the picker closes', async ({ page }) => {
  const mock = await mockGiphy(page);
  let finishLate: (() => void) | undefined;
  let lateReleased = false;
  mock.respondWith(async request => {
    if (request.query === 'failure') return { status: 429, body: { data: [], meta: { status: 429, msg: 'Rate limited', response_id: 'fixture-error' } } };
    if (request.query === 'late' && !lateReleased) await new Promise<void>(resolve => { finishLate = () => { lateReleased = true; resolve(); }; });
    return { status: 200, body: { data: [giphyFixture(`${request.query || 'trending'}-0`)],
      pagination: { offset: 0, count: 1, total_count: 1 }, meta: { status: 200, msg: 'OK', response_id: 'fixture-response' } } };
  });
  const diagnostics = await openStudio(page, false, true);
  await page.locator('.image-editor-button').click();
  await page.locator('.giphy-search-input').fill('failure');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-dialog')).toContainText(/could not|try again|unavailable|error|limit/i);
  await expect(page.locator('.giphy-search-button')).toBeEnabled();
  await page.locator('.giphy-search-input').fill('late');
  await page.locator('.giphy-search-button').click();
  await expect.poll(() => Boolean(finishLate)).toBe(true);
  await page.locator('.giphy-close').click();
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  finishLate!();
  await page.locator('.image-editor-button').click();
  await page.locator('.giphy-search-input').fill('fresh');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result[data-giphy-id="fresh-0"]')).toBeVisible();
  await expect(page.locator('.giphy-result[data-giphy-id="late-0"]')).toHaveCount(0);
  await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'false');
  diagnostics.verify();
});

test('keeps configured GIPHY search controls touchable and returns focus after closing on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 667 });
  const mock = await mockGiphy(page);
  const diagnostics = await openStudio(page, false, true);
  const opener = page.locator('.image-editor-button');
  await opener.click();
  await expect(page.locator('.giphy-search-input')).toBeFocused();
  await page.locator('.giphy-search-input').fill('phone');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result[data-giphy-id="phone-0"]')).toBeVisible();
  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>('.giphy-dialog')!;
    return { width: document.documentElement.scrollWidth, controls: [...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.hidden && button.offsetParent !== null).map(button => {
      const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, left: box.left, right: box.right };
    }) };
  });
  expect(layout.width).toBeLessThanOrEqual(320);
  for (const control of layout.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.left).toBeGreaterThanOrEqual(0); expect(control.right).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: testInfo.outputPath('giphy-phone.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  await expect(opener).toBeFocused();
  expect(mock.requests.some(request => request.query === 'phone')).toBe(true);
  diagnostics.verify();
});

test('cancels a pending GIPHY download when closing the picker without changing the prepared film', async ({ page }) => {
  await mockGiphy(page);
  let finishDownload: (() => void) | undefined;
  let responseReleased = false;
  await page.route('https://media.giphy.com/**', async route => {
    if (route.request().resourceType() !== 'fetch') { await route.fallback(); return; }
    await new Promise<void>(resolve => { finishDownload = resolve; });
    await route.fulfill({ contentType: 'image/gif', body: colorCycleGifFixture(), headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
    responseReleased = true;
  });
  const diagnostics = await openStudio(page, false, true);
  await page.locator('.quote-input').fill('Go.');
  await createAndPause(page);
  await page.locator('.image-file').setInputFiles({ name: 'kept.png', mimeType: 'image/png', buffer: await imageFixture(page, 64, 64) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(2);
    return { spec: structuredClone(dev.spec), time: dev.renderer.lastTime, state: structuredClone(dev.state()) };
  });
  await page.locator('.image-film-button').click();
  await page.locator('.giphy-search-input').fill('cancel');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result[data-giphy-id="cancel-0"]')).toBeVisible();
  await page.locator('.giphy-result[data-giphy-id="cancel-0"]').click();
  await expect.poll(() => Boolean(finishDownload), { message: 'The selected GIF download must be pending before cancellation.' }).toBe(true);
  await expect(page.locator('.image-film-button')).toBeDisabled();
  await page.locator('.giphy-close').click();
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  await expect(page.locator('.image-film-button')).toBeEnabled();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const afterClose = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, time: dev.renderer.lastTime, state: dev.state() };
  });
  expect(afterClose).toEqual(before);
  finishDownload!();
  await expect.poll(() => responseReleased).toBe(true);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const afterResponse = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, time: dev.renderer.lastTime, state: dev.state() };
  });
  expect(afterResponse, 'An obsolete GIF response must not append a phantom image or change the film time.').toEqual(before);
  diagnostics.verify();
});

test('retains the prepared film and returns focus to the selected GIPHY result when its media download is invalid', async ({ page }) => {
  await mockGiphy(page);
  let invalidDownloads = 0;
  await page.route('https://media.giphy.com/**', async route => {
    if (route.request().resourceType() !== 'fetch') { await route.fallback(); return; }
    invalidDownloads++;
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Unavailable GIF</title>', headers: { 'access-control-allow-origin': '*' } });
  });
  const diagnostics = await openStudio(page, false, true);
  await page.locator('.quote-input').fill('Go.');
  await createAndPause(page);
  await page.locator('.image-file').setInputFiles({ name: 'kept.png', mimeType: 'image/png', buffer: await imageFixture(page, 64, 64) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(2);
    dev.renderer.renderFrame(dev.renderer.lastTime);
    return { spec: structuredClone(dev.spec), time: dev.renderer.lastTime, state: structuredClone(dev.state()), image: dev.renderer.canvas.toDataURL() };
  });
  const opener = page.locator('.image-film-button');
  await opener.click();
  await page.locator('.giphy-search-input').fill('invalid');
  await page.locator('.giphy-search-button').click();
  const result = page.locator('.giphy-result[data-giphy-id="invalid-0"]');
  await expect(result).toBeVisible();
  await expect(result.locator('.giphy-preview')).toHaveJSProperty('naturalWidth', 64);
  await result.click();
  await expect(page.locator('.giphy-status')).toHaveText('This GIF could not be added. Try again or choose another.');
  await expect(page.locator('.giphy-dialog')).toBeVisible();
  await expect(result).toBeEnabled();
  await expect(result, 'A failed selection must return keyboard focus to the GIF so another attempt remains reachable.').toBeFocused();
  await expect(opener).toBeEnabled();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  expect(invalidDownloads).toBe(1);
  const after = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.renderer.renderFrame(dev.renderer.lastTime);
    return { spec: dev.spec, time: dev.renderer.lastTime, state: dev.state(), image: dev.renderer.canvas.toDataURL() };
  });
  expect(after, 'Invalid remote media must leave the existing image, film and selected time intact.').toEqual(before);
  await page.locator('.giphy-close').click();
  await expect(opener).toBeFocused();
  diagnostics.verify();
});

test('restores the prepared film and opener focus when closing GIPHY during renderer preparation', async ({ page }) => {
  await mockGiphy(page);
  const diagnostics = await openStudio(page, false, true);
  await page.locator('.quote-input').fill('Go.');
  await createAndPause(page);
  await page.locator('.image-file').setInputFiles({ name: 'kept.png', mimeType: 'image/png', buffer: await imageFixture(page, 64, 64) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(2);
    const renderer = dev.renderer;
    const originalPrepare = renderer.prepare.bind(renderer);
    const prepareCounts: number[] = [];
    let release!: () => void;
    let started = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    renderer.prepare = async nextSpec => {
      prepareCounts.push(nextSpec.finalImages?.length ?? 0);
      await originalPrepare(nextSpec);
      if (nextSpec.finalImages?.length === 2) {
        started = true;
        await gate;
      }
    };
    Object.assign(window, { __GIPHY_PREPARE_TEST__: { get started() { return started; }, release, prepareCounts } });
    renderer.renderFrame(renderer.lastTime);
    return { spec: structuredClone(dev.spec), time: dev.renderer.lastTime, state: structuredClone(dev.state()), image: renderer.canvas.toDataURL() };
  });
  const opener = page.locator('.image-film-button');
  await opener.click();
  await page.locator('.giphy-search-input').fill('prepare');
  await page.locator('.giphy-search-button').click();
  const result = page.locator('.giphy-result[data-giphy-id="prepare-0"]');
  await expect(result).toBeVisible();
  await result.click();
  await page.waitForFunction(() => (window as unknown as { __GIPHY_PREPARE_TEST__: { started: boolean } }).__GIPHY_PREPARE_TEST__.started);
  await expect(opener).toBeDisabled();
  await page.locator('.giphy-close').click();
  await expect(page.locator('.giphy-dialog')).toBeHidden();
  await expect(opener, 'The opener remains disabled until the cancelled scene preparation and rollback finish.').toBeDisabled();
  await page.evaluate(() => (window as unknown as { __GIPHY_PREPARE_TEST__: { release(): void } }).__GIPHY_PREPARE_TEST__.release());
  await expect(opener).toBeEnabled();
  await expect(opener, 'Closing during preparation must defer restoring focus until the opener is enabled.').toBeFocused();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  expect(await page.evaluate(() => (window as unknown as { __GIPHY_PREPARE_TEST__: { prepareCounts: number[] } }).__GIPHY_PREPARE_TEST__.prepareCounts)).toEqual([2, 1]);
  const after = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.renderer.renderFrame(dev.renderer.lastTime);
    return { spec: dev.spec, time: dev.renderer.lastTime, state: dev.state(), image: dev.renderer.canvas.toDataURL() };
  });
  expect(after, 'An aborted prepared GIF must restore the previous renderer, image list and selected time.').toEqual(before);
  diagnostics.verify();
});

test('optionally validates live GIPHY trending, search, attribution and animated selection', async ({ page }) => {
  test.skip(process.env.CREACTORS_GIPHY_LIVE !== '1', 'Explicitly enabled live check; normal runs use local API/media fixtures.');
  test.setTimeout(120000);
  const diagnostics = await openStudio(page, false, true);
  await page.locator('.quote-input').fill('Celebrate.');
  await page.locator('.image-editor-button').click();
  await expect(page.locator('.giphy-search-button'), 'Configure a GIPHY key before running the live check.').toBeEnabled();
  await expect(page.locator('.giphy-result').first(), 'Live GIPHY trending must return visible GIFs.').toBeVisible({ timeout: 30000 });
  await page.locator('.giphy-search-input').fill('celebration');
  await page.locator('.giphy-search-button').click();
  await expect(page.locator('.giphy-result').first(), 'Live GIPHY search must return visible GIFs.').toBeVisible({ timeout: 30000 });
  await expect(page.locator('.giphy-search-button')).toBeEnabled({ timeout: 30000 });
  await page.locator('.giphy-result').first().click();
  await expect(page.locator('.studio'), 'The chosen live GIF must finish downloading and decoding.').toHaveAttribute('data-image-count', '1', { timeout: 60000 });
  await createAndPause(page);
  const report = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const image = dev.spec.finalImages![0]!, animation = image.asset.animation;
    if (!animation || animation.frames.length < 2) throw new Error('The selected live GIF has no multiple decoded frames.');
    const uniqueFrames = animation.frames.map((frame, index) => ({ frame, index }))
      .filter(({ frame, index }, _position, all) => all.findIndex(other => other.frame.source === frame.source) === index).slice(0, 2);
    const textExitEnd = Math.max(image.entrance.end, ...dev.spec.objects.map(object => object.exit?.end ?? 0));
    const times = uniqueFrames.map(({ frame, index }) => {
      const phase = ((index ? animation.frames[index - 1]!.end : 0) + frame.end) / 2;
      const first = image.entrance.end + phase;
      return first + Math.max(0, Math.ceil((textExitEnd - first) / animation.duration)) * animation.duration;
    });
    const captures = [];
    for (const time of times) captures.push(await dev.capture(time));
    return { name: image.asset.name, attribution: image.asset.attribution,
      frames: animation.frames.length, distinctSources: new Set(animation.frames.map(frame => frame.source)).size,
      distinctCaptures: new Set(captures).size, duration: animation.duration };
  });
  expect(report.name.length).toBeGreaterThan(0);
  expect(report.frames).toBeGreaterThan(1);
  expect(report.duration).toBeGreaterThan(0);
  expect(report.distinctSources).toBeGreaterThan(1);
  expect(report.distinctCaptures).toBeGreaterThan(1);
  expect(report.attribution?.provider).toBe('giphy');
  expect(report.attribution?.id.length).toBeGreaterThan(0);
  expect(report.attribution?.pageUrl).toContain('giphy.com');
  expect(report.attribution?.creatorUrl).toBeTruthy();
  diagnostics.verify();
});

test('welcomes with the current example in a silent animated loop while keeping the editor ready', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.assign(window, { __STARTUP_AUDIO_CONTEXTS__: 0 });
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args) {
        (window as unknown as { __STARTUP_AUDIO_CONTEXTS__: number }).__STARTUP_AUDIO_CONTEXTS__++;
        return Reflect.construct(target, args);
      },
    });
  });
  await page.clock.install();
  const diagnostics = await openStudio(page, true);
  const initial = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, analysis: dev.analysis, state: dev.state() };
  });
  expect(initial.spec.sourceText).toBe(await page.locator('.quote-input').inputValue());
  expect(initial.analysis?.sourceText).toBe(initial.spec.sourceText);
  expect(initial.spec.generatorVersion).not.toMatch(/^authored/);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.studio')).toHaveAttribute('data-editing', 'true');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  await expect(page.locator('.quote-panel')).toBeVisible();
  await expect(page.locator('.create-button')).toBeEnabled();
  await expect(page.locator('.playback')).toBeHidden();
  await expect(page.locator('#film-transcript')).toHaveText(initial.spec.sourceText);
  await expect(page.locator('.film-duration')).toHaveText(`${Math.round(initial.spec.duration * 10) / 10} S`);

  const frames: Buffer[] = [];
  await mkdir('artifacts/startup', { recursive: true });
  for (const milliseconds of [750, 1750, 2000]) {
    await page.clock.fastForward(milliseconds);
    frames.push(await page.locator('.stage canvas').screenshot());
    await writeFile(`artifacts/startup/welcome-${frames.length}.png`, frames.at(-1)!);
    await testInfo.attach(`welcome-${frames.length}`, { body: frames.at(-1)!, contentType: 'image/png' });
  }
  expect(new Set(frames.map(frame => frame.toString('base64'))).size, 'The welcome must visibly move instead of retaining a fixed poster').toBeGreaterThan(1);
  const moving = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());
  expect(moving.time).not.toBe(initial.state.time);
  const elapsed = initial.spec.duration * 1000 + 400;
  await page.clock.fastForward(elapsed);
  const looping = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());
  expect(looping.time).toBeGreaterThanOrEqual(0);
  expect(looping.time).toBeLessThan(initial.spec.duration);
  expect(Math.abs(looping.time - ((moving.time + elapsed / 1000) % initial.spec.duration))).toBeLessThan(0.05);
  expect(await page.evaluate(() => (window as unknown as { __STARTUP_AUDIO_CONTEXTS__: number }).__STARTUP_AUDIO_CONTEXTS__)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.audio)).toBeNull();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  diagnostics.verify();
});

test('keeps a readable welcome poster still when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  const diagnostics = await openStudio(page, true);
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { state: dev.state(), poster: dev.spec.posterTime };
  });
  expect(before.state.time).toBe(before.poster);
  await page.clock.fastForward(4000);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(before.state);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  await expect(page.locator('.quote-panel')).toBeVisible();
  diagnostics.verify();
});

test('stops the welcome on editing and keeps the draft untouched through other controls', async ({ page }) => {
  await page.clock.install();
  const diagnostics = await openStudio(page, true);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.clock.fastForward(600);
  await page.locator('.quote-input').focus();
  const frozen = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());
  await page.clock.fastForward(1200);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(frozen);
  const draft = 'Mes mots arrivent exactement comme je les écris.';
  await page.locator('.quote-input').fill(draft);
  await page.locator('[data-locale="fr"]').click();
  await page.locator('.help-button').click();
  await page.keyboard.press('Escape');
  await page.clock.fastForward(1000);
  await expect(page.locator('.quote-input')).toHaveValue(draft);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(frozen);
  await createAndPause(page);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.sourceText)).toBe(draft);
  diagnostics.verify();
});

test('resumes only the welcome after visibility changes and keeps an explicitly created film paused', async ({ page }) => {
  await page.clock.install();
  const diagnostics = await openStudio(page, true);
  const setHidden = async (hidden: boolean) => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await page.clock.fastForward(600);
  await setHidden(true);
  const hiddenWelcome = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());
  await page.clock.fastForward(1200);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(hiddenWelcome);
  await setHidden(false);
  await page.clock.fastForward(600);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).not.toBe(hiddenWelcome.time);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.clock.fastForward(600);
  await setHidden(true);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  const hiddenFilm = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());
  await setHidden(false);
  await page.clock.fastForward(1200);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(hiddenFilm);
  diagnostics.verify();
});

test('keeps a photo pending before CREATE and adds it to the created film rather than the welcome', async ({ page }) => {
  const diagnostics = await openStudio(page, true);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.image-file').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: await imageFixture(page) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  await createAndPause(page);
  const created = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(created.sourceText).toBe(original.sourceText);
  expect(created.finalImages?.map(image => image.asset.name)).toEqual(['pending.png']);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  diagnostics.verify();
});

test('CREATE during initial font preparation uses the exact current draft and cannot be overwritten by the welcome', async ({ page }) => {
  await page.addInitScript(() => {
    const load = FontFace.prototype.load;
    const releases: (() => void)[] = [];
    Object.assign(window, { __RELEASE_STARTUP_FONTS__: () => { for (const release of releases.splice(0)) release(); }, __STARTUP_FONT_RELEASES__: releases });
    FontFace.prototype.load = function () {
      const pending = load.call(this);
      if (!this.family.includes('Barlow Condensed')) return pending;
      return pending.then(font => new Promise<FontFace>(resolve => releases.push(() => resolve(font))));
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __STARTUP_FONT_RELEASES__: (() => void)[] }).__STARTUP_FONT_RELEASES__?.length > 0);
  const draft = 'This exact sentence wins the race.';
  await page.locator('.quote-input').fill(draft);
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'preparing');
  await page.evaluate(() => (window as unknown as { __RELEASE_STARTUP_FONTS__: () => void }).__RELEASE_STARTUP_FONTS__());
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const created = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, analysis: dev.analysis };
  });
  expect(created.spec.sourceText).toBe(draft);
  expect(created.analysis?.sourceText).toBe(draft);
  await expect(page.locator('.quote-input')).toHaveValue(draft);
  await expect(page.locator('#film-transcript')).toHaveText(draft);
  expect(errors).toEqual([]);
});

test('loads random bilingual examples and chooses another without changing the current film', async ({ page }) => {
  const diagnostics = await openStudio(page, true);
  const quote = page.locator('.quote-input');
  const first = await quote.inputValue();
  expect(EXAMPLES.en).toContain(first);
  await expect(page.locator('.example-button')).toHaveAccessibleName('Another phrase');
  const before = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(before.sourceText).toBe(first);
  await expect(page.locator('#film-transcript')).toHaveText(first);
  const seen = new Set([first]);
  for (let index = 0; index < 5; index++) {
    await page.locator('.example-button').click();
    const next = await quote.inputValue();
    expect(EXAMPLES.en).toContain(next);
    expect(seen.has(next)).toBe(false);
    seen.add(next);
  }
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(before);

  await quote.fill('Mon propre texte reste exactement ici.');
  await page.locator('[data-locale="fr"]').click();
  await expect(quote).toHaveValue('Mon propre texte reste exactement ici.');
  await expect(page.locator('.example-button')).toHaveAccessibleName('Autre phrase');
  await page.locator('.example-button').focus();
  await page.keyboard.press('Enter');
  expect(EXAMPLES.fr).toContain(await quote.inputValue());
  await expect(page.locator('.input-language-switch')).toHaveCount(0);

  await page.locator('[data-locale="en"]').click();
  await page.locator('.example-button').click();
  expect(EXAMPLES.en).toContain(await quote.inputValue());
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await createAndPause(page);
  const currentFilm = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.edit-button').click();
  await page.locator('.example-button').click();
  expect(await quote.inputValue()).not.toBe(currentFilm.sourceText);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(currentFilm);
  await expect(page.locator('#film-transcript')).toHaveText(currentFilm.sourceText);
  diagnostics.verify();
});

test('loads a French example from browser locale and keeps the new control usable on small phones', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, locale: 'fr-FR', viewport: { width: 320, height: 667 }, colorScheme: 'light' });
  const page = await context.newPage();
  try {
    const diagnostics = await openStudio(page, true);
    expect(EXAMPLES.fr).toContain(await page.locator('.quote-input').inputValue());
    const box = await page.locator('.example-button').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const metrics = await page.evaluate(() => {
      const stage = document.querySelector('.stage')!.getBoundingClientRect();
      return { width: document.documentElement.scrollWidth, aspect: stage.width / stage.height };
    });
    expect(metrics.width).toBeLessThanOrEqual(320);
    expect(metrics.aspect).toBeCloseTo(9 / 16, 3);
    await page.locator('.example-button').click();
    expect(EXAMPLES.fr).toContain(await page.locator('.quote-input').inputValue());
    await testInfo.attach('examples-phone-light', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    diagnostics.verify();
  } finally { await context.close(); }
});

test('uses double spaces in the input to force separate film groups', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = '  Une  petite étincelle   vient de tout changer.  ';
  await page.locator('.quote-input').fill(text);
  await createAndPause(page);
  const result = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { analysis: dev.analysis!, spec: dev.spec };
  });
  const groups = result.analysis.groups;
  expect(groups.slice(0, 2).map(group => group.text.trim())).toEqual(['Une', 'petite étincelle']);
  expect(groups[2]!.tokens[0]!.text).toBe('vient');
  expect(groups.every(group => group.wordCount >= 1 && group.wordCount <= 4)).toBe(true);
  expect(result.spec.sourceText).toBe(text);
  expect(result.spec.objects.map(object => object.text)).toEqual(groups.map(group => group.text));
  expect(result.spec.objects.map(object => object.text).join('')).toBe(text);
  await expect(page.locator('.quote-input')).toHaveValue(text);
  diagnostics.verify();
});

test('renders compact two-to-four-word groups without losing text or clipping their reading holds', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const phrases = [
    'Une petite étincelle vient de bouleverser complètement mon emploi du temps. Maintenant nous créons autrement.',
    'Our imagination suddenly transforms extraordinary possibilities into unforgettable experiences. We do not simply wait for tomorrow.',
    'Nous ne voulons absolument jamais abandonner nos idées les plus extraordinaires.',
  ];
  for (const text of phrases) {
    await page.locator('.quote-input').fill(text);
    await createAndPause(page);
    const result = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      const boxes = dev.spec.objects.map(object => {
        dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
        return dev.bounds().find(box => box.id === object.id)!;
      });
      return { analysis: dev.analysis!, source: dev.spec.objects.map(object => object.text).join(''), boxes };
    });
    expect(result.source).toBe(text);
    expect(result.analysis.version).toBe('fr-en-scanner-2');
    expect(result.analysis.groups.every(group => group.wordCount <= 4)).toBe(true);
    expect(result.analysis.groups.filter(group => group.wordCount === 2).length).toBeGreaterThan(0);
    for (const box of result.boxes) {
      expect(box.min[0]).toBeGreaterThan(-0.85);
      expect(box.max[0]).toBeLessThan(0.85);
      expect(box.min[1]).toBeGreaterThan(-0.65);
      expect(box.max[1]).toBeLessThan(0.76);
    }
  }
  diagnostics.verify();
});

async function createAndPause(page: Page) {
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
}

/** Explicitly retain the authored reference-film checks independently of boot content. */
async function loadAuthoredReference(page: Page) {
  await page.evaluate(async text => {
    await (window as unknown as DebugWindow).__CREACTORS_DEV__.generate(text);
  }, FUTURE_QUOTE);
}

test('creates, pauses, and evaluates the same frame independently of playback history', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  await expect(page.locator('.quote-input')).toHaveValue(FUTURE_QUOTE);
  await expect(page.locator('.quote-input')).not.toHaveAttribute('readonly', '');
  await createAndPause(page);

  const states = await page.evaluate(() => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    debug.seek(7.8);
    const direct = structuredClone(debug.state());
    for (const time of [0, 10.8, 3.5, 5, 12, 7.8]) debug.seek(time);
    return { direct, revisited: debug.state() };
  });
  expect(states.revisited).toEqual(states.direct);
  expect(states.direct.time).toBe(7.8);

  const captures = await page.evaluate(async () => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return {
      first: await debug.capture(0),
      final: await debug.capture(debug.spec.duration),
      lastExportFrame: await debug.capture(debug.spec.duration - 1 / 30),
      poster: await debug.capture(debug.spec.posterTime!),
    };
  });
  expect(captures.first).toMatch(/^data:image\/png;base64,/);
  expect(captures.final).toMatch(/^data:image\/png;base64,/);
  expect(captures.final, 'The loop must end on precisely the same empty background as it starts').toEqual(captures.first);
  expect(captures.lastExportFrame).toEqual(captures.first);
  expect(captures.poster).not.toEqual(captures.first);

  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(0));
  await testInfo.attach('opening-frame', { body: await page.locator('.stage canvas').screenshot(), contentType: 'image/png' });
  await page.evaluate(() => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    debug.seek(debug.spec.posterTime!);
  });
  await testInfo.attach('final-frame', { body: await page.locator('.stage canvas').screenshot(), contentType: 'image/png' });

  await page.locator('.replay-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const restartedTime = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  expect(restartedTime).toBeLessThan(2);
  diagnostics.verify();
});

test('shows a brief stable final poster without repeating the full quotation reading time', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  const cases = [
    { text: FUTURE_QUOTE, seed: 20261009, language: 'fr' as const },
    { text: 'Make it happen.', seed: 42, language: 'en' as const },
    { text: "L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.", seed: 77, language: 'fr' as const },
  ];
  for (const fixture of cases) {
    const poster = await page.evaluate(async fixture => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      await dev.generate(fixture.text, fixture.seed, fixture.language);
      const track = dev.spec.cameraTracks.find(track => track.id === 'poster' || track.id === 'final-composition')!;
      const states = [track.start + 1 / dev.spec.fps, (track.start + track.end) / 2, track.end - 1 / dev.spec.fps].map(time => {
        dev.seek(time);
        return { camera: dev.state().camera, objects: dev.state().objects };
      });
      return { duration: track.end - track.start, states, text: dev.spec.sourceText,
        frame: await dev.capture(dev.spec.posterTime!), empty: await dev.capture(dev.spec.duration) };
    }, fixture);
    expect(poster.text).toBe(fixture.text);
    expect(poster.duration, 'The complete composition is a quick visual conclusion after its words have already been read').toBeGreaterThanOrEqual(0.3);
    expect(poster.duration).toBeLessThanOrEqual(0.5);
    expect(poster.states[1]).toEqual(poster.states[0]);
    expect(poster.states[2]).toEqual(poster.states[0]);
    expect(poster.frame).not.toEqual(poster.empty);
    await testInfo.attach(`brief-poster-${fixture.seed}`, { body: Buffer.from(poster.frame.split(',')[1]!, 'base64'), contentType: 'image/png' });
  }
  diagnostics.verify();
});

test('switches interface language without translating the quotation or changing the scene', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('[data-locale="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.create-button')).toHaveAccessibleName('Create a typography film');
  await expect(page.locator('.quote-input')).toHaveValue(FUTURE_QUOTE);
  await createAndPause(page);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(6.8));
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state());

  await page.locator('[data-locale="fr"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.toggle-button')).toHaveAccessibleName('Lire');
  await expect(page.locator('[data-locale="fr"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-locale="en"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.quote-input')).toHaveValue(FUTURE_QUOTE);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state())).toEqual(original);
  diagnostics.verify();
});

test('travels continuously as the first sentence leaves and the second arrives', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await loadAuthoredReference(page);
  const transition = await page.evaluate(async () => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const frames = [4.6, 4.8, 5, 5.2, 5.45].map(time => {
      debug.seek(time);
      return { time, state: debug.state(), bounds: debug.bounds() };
    });
    debug.seek(5 - 0.0001);
    const before = debug.state().camera;
    debug.seek(5 + 0.0001);
    const after = debug.state().camera;
    const blank = await debug.capture(12);
    const emptyFrames = [];
    for (let frame = Math.ceil(4.6 * debug.spec.fps); frame <= Math.floor(5.45 * debug.spec.fps); frame++) {
      const time = frame / debug.spec.fps;
      if (await debug.capture(time) === blank) emptyFrames.push(time);
    }
    return { frames, before, after, emptyFrames };
  });

  expect(transition.emptyFrames, 'Every transition frame must contain visible typography').toEqual([]);

  const awaitingBounds = transition.frames.map(frame => frame.bounds.find(object => object.id === 'awaiting')!);
  for (let index = 1; index < awaitingBounds.length; index++) {
    expect(awaitingBounds[index].max[1], 'The outgoing words must travel down rather than disappear at a cut')
      .toBeLessThan(awaitingBounds[index - 1].max[1]);
  }
  expect(awaitingBounds[awaitingBounds.length - 1].max[1], 'The entire first sentence must leave below the frame')
    .toBeLessThan(-1);

  const arrival = transition.frames.map(frame => frame.bounds.find(object => object.id === 'turn')!);
  expect(arrival[0].min[1], 'The second sentence must approach from outside the frame').toBeGreaterThan(1);
  expect(arrival[3].min[1], 'The incoming words must be visible during the travelling').toBeLessThan(1);
  expect(arrival[3].max[1]).toBeGreaterThan(-1);
  const settled = arrival[arrival.length - 1];
  expect(settled.min[0]).toBeGreaterThanOrEqual(-0.84);
  expect(settled.max[0]).toBeLessThanOrEqual(0.84);
  expect(settled.min[1]).toBeGreaterThanOrEqual(-0.64);
  expect(settled.max[1]).toBeLessThanOrEqual(0.76);
  expect((settled.max[1] - settled.min[1]) * 640 / 2).toBeGreaterThan(48);

  const cameraDistance = Math.hypot(...transition.after.position.map((value, axis) => value - transition.before.position[axis]));
  expect(cameraDistance, 'Crossing the former cut must not jump the camera').toBeLessThan(0.02);
  const quaternionDot = transition.after.quaternion.reduce((sum, value, axis) => sum + value * transition.before.quaternion[axis], 0);
  expect(Math.abs(quaternionDot)).toBeGreaterThan(0.9999);
  for (const frame of transition.frames) {
    expect([...frame.state.camera.position, ...frame.state.camera.quaternion].every(Number.isFinite)).toBe(true);
    for (const bounds of frame.bounds) expect([...bounds.min, ...bounds.max].every(Number.isFinite)).toBe(true);
  }
  diagnostics.verify();
});

test('rushes through the camera cleanly and keeps playing across repeated loop boundaries', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await loadAuthoredReference(page);
  const exit = await page.evaluate(() => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const rush = debug.spec.cameraTracks.find(track => track.id === 'rush-to-screen')!;
    const frames = [];
    // Render every export frame through the lens crossing, including the
    // empty hold. Projection bounds are intentionally not used behind camera.
    for (let frame = Math.floor(rush.start * debug.spec.fps); frame <= Math.ceil(debug.spec.duration * debug.spec.fps); frame++) {
      debug.seek(frame / debug.spec.fps);
      frames.push(debug.state());
    }
    return { frames, final: debug.state(), rushStart: rush.start, duration: debug.spec.duration };
  });
  for (const frame of exit.frames) {
    for (const object of frame.objects) {
      expect([...object.position, ...object.rotation, object.scale].every(Number.isFinite)).toBe(true);
    }
  }
  for (const object of exit.final.objects) {
    expect(object.position[2], `${object.id} must have passed the stationary lens`).toBeGreaterThan(exit.final.camera.position[2]);
  }

  // Font/shader preparation has finished before taking over animation time.
  await page.clock.install();
  await page.locator('.replay-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  const beforeSeam = exit.rushStart + 0.1;
  await page.clock.fastForward(Math.round(beforeSeam * 1000));
  const departing = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  expect(departing).toBeGreaterThanOrEqual(beforeSeam - 1 / 30);
  // Clicking replay starts just before the controlled clock advance; allow
  // its small real-time lead while still sampling inside the departure.
  expect(departing).toBeLessThan(beforeSeam + 0.15);

  await page.clock.fastForward(Math.round((exit.duration - beforeSeam + 0.2) * 1000));
  const afterSeam = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  expect(afterSeam).toBeGreaterThanOrEqual(0);
  expect(afterSeam).toBeLessThan(1);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');

  await page.clock.fastForward(Math.round(exit.duration * 2000));
  const afterMoreLoops = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  expect(afterMoreLoops).toBeGreaterThanOrEqual(0);
  expect(afterMoreLoops).toBeLessThan(1);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});

test('keeps a portrait film and usable playback controls inside the mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await expect(page.locator('.quote-panel')).toBeHidden();
  await expect(page.locator('.toggle-button')).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.stage canvas')!;
    const stage = document.querySelector<HTMLElement>('.stage')!;
    const toolbar = document.querySelector<HTMLElement>('.playback')!;
    const rect = stage.getBoundingClientRect();
    const controls = toolbar.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      x: rect.x,
      right: rect.right,
      toolbarBottom: controls.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      pixelAspect: canvas.width / canvas.height,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(dimensions.width / dimensions.height).toBeCloseTo(9 / 16, 2);
  expect(dimensions.pixelAspect).toBeCloseTo(9 / 16, 2);
  expect(dimensions.width).toBeGreaterThan(250);
  expect(dimensions.x).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth);
  expect(dimensions.toolbarBottom).toBeLessThanOrEqual(dimensions.viewportHeight);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  diagnostics.verify();
});

test('seeks a paused film by keyboard and pointer without changing its direction', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const before = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  const bar = page.getByRole('slider', { name: 'Seek through the film' });
  await bar.press('Home');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBe(0);
  await bar.press('ArrowRight');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBeCloseTo(1, 9);
  await bar.press('Shift+ArrowRight');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBeCloseTo(6, 9);
  await bar.press('End');
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'ended');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBe(before.duration);
  await bar.press('Home');
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
  const selected = Number(await bar.inputValue());
  expect(selected).toBeGreaterThan(before.duration * 0.35);
  expect(selected).toBeLessThan(before.duration * 0.55);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBeCloseTo(selected, 6);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(before);
  diagnostics.verify();
});

test('pauses while dragging the playback bar and resumes synchronized audio after releasing outside it', async ({ page }) => {
  await page.clock.install();
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('.audio-button').click();
  await page.locator('.audio-file').setInputFiles({ name: 'seek.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.studio')).toHaveAttribute('data-has-audio', 'true');
  await page.evaluate(() => {
    const start = AudioBufferSourceNode.prototype.start;
    const offsets: number[] = [];
    Object.assign(window, { __SEEK_AUDIO_OFFSETS__: offsets });
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      offsets.push(offset);
      start.call(this, when, offset, duration);
    };
  });
  await page.locator('.toggle-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.clock.runFor(200);
  const bar = page.locator('.progress-track');
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height / 2, { steps: 5 });
  const selected = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  await page.clock.runFor(400);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBe(selected);
  const startsBeforeRelease = await page.evaluate(() => (window as unknown as { __SEEK_AUDIO_OFFSETS__: number[] }).__SEEK_AUDIO_OFFSETS__.length);
  await page.mouse.move(box.x + box.width * 0.65, box.y - 25);
  await page.mouse.up();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __SEEK_AUDIO_OFFSETS__: number[] }).__SEEK_AUDIO_OFFSETS__.length)).toBeGreaterThan(startsBeforeRelease);
  await page.clock.runFor(500);
  const resumed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time);
  expect(resumed).toBeCloseTo(selected + 0.5, 1);
  await page.locator('.toggle-button').click();
  diagnostics.verify();
});

test('does not resume an interrupted or cancelled playback-bar gesture', async ({ page }) => {
  await page.clock.install();
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const bar = page.locator('.progress-track');
  const box = (await bar.boundingBox())!;
  await page.locator('.toggle-button').click();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await bar.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await page.mouse.up();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await page.locator('.toggle-button').click();
  await page.mouse.down();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.mouse.up();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(500);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});

test('keeps the playback bar touch accessible on a small phone and disabled during export', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 320, height: 667 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const diagnostics = await openStudio(page);
    await createAndPause(page);
    const bar = page.locator('.progress-track');
    const box = (await bar.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2);
    const selected = Number(await bar.inputValue());
    expect(selected).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBeCloseTo(selected, 6);
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
    await mkdir('artifacts/ui', { recursive: true });
    await page.screenshot({ path: 'artifacts/ui/seek-mobile.png', fullPage: true });
    await page.locator('.download-button').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
    await expect(bar).toBeDisabled();
    await page.locator('.cancel-export-button').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
    await expect(bar).toBeEnabled();
    diagnostics.verify();
  } finally { await context.close(); }
});

test('blocks touch zoom on phones and tablets while keeping dialogs scrollable', async ({ browser }, testInfo) => {
  for (const viewport of [{ width: 320, height: 480 }, { width: 768, height: 1024 }]) {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    try {
      const diagnostics = await openStudio(page);
      const client = await context.newCDPSession(page);
      const canvas = (await page.locator('.stage canvas').boundingBox())!;
      const x = canvas.x + canvas.width / 2;
      const y = canvas.y + canvas.height / 2;
      await client.send('Input.synthesizePinchGesture', { x, y, scaleFactor: 2, relativeSpeed: 800, gestureSourceType: 'touch' });
      expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);
      expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
      await page.locator('.help-button').click();
      const dialog = page.locator('.help-dialog');
      const box = (await dialog.boundingBox())!;
      if (viewport.width === 320) expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await client.send('Input.synthesizeScrollGesture', {
        x: box.x + box.width / 2, y: box.y + box.height * 0.8,
        yDistance: -180, gestureSourceType: 'touch',
      });
      if (await dialog.evaluate(element => element.scrollHeight > element.clientHeight)) {
        await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      }
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      diagnostics.verify();
    } finally { await context.close(); }
  }
});

test('keeps every reading hold and the final composition inside social safe margins', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await loadAuthoredReference(page);
  const frames = await page.evaluate((posterTime) => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const results = [];
    for (const object of debug.spec.objects) {
      const [start, end] = object.readingInterval;
      for (let time = start; time < end; time += 1 / debug.spec.fps) {
        debug.seek(time);
        results.push({ time, active: object.id, bounds: debug.bounds() });
      }
    }
    debug.seek(posterTime);
    results.push({ time: posterTime, active: null, bounds: debug.bounds() });
    return results;
  }, FUTURE_POSTER_TIME);
  for (const frame of frames) {
    const reading = frame.active ? frame.bounds.filter(object => object.id === frame.active) : frame.bounds;
    for (const object of reading) {
      const label = `${object.id} at ${frame.time.toFixed(3)}s`;
      // NDC converts the agreed 8% / 12% / 18% margins into these limits.
      expect(object.min[0], label).toBeGreaterThanOrEqual(-0.84);
      expect(object.max[0], label).toBeLessThanOrEqual(0.84);
      expect(object.min[1], label).toBeGreaterThanOrEqual(-0.64);
      expect(object.max[1], label).toBeLessThanOrEqual(0.76);
      expect(object.min[2], label).toBeGreaterThan(-1);
      expect(object.max[2], label).toBeLessThan(1);
      // All five authored groups have two lines. Reserve at least 48px for
      // their combined glyph height on a 360px-wide phone.
      expect((object.max[1] - object.min[1]) * 640 / 2, label).toBeGreaterThan(48);
      for (const other of frame.bounds.filter(item => item.id !== object.id)) {
        const overlapX = Math.min(object.max[0], other.max[0]) - Math.max(object.min[0], other.min[0]);
        const overlapY = Math.min(object.max[1], other.max[1]) - Math.max(object.min[1], other.min[1]);
        expect(overlapX <= 0 || overlapY <= 0, `${label} overlaps ${other.id}`).toBe(true);
      }
    }
  }
  diagnostics.verify();
});

test('preserves visible keyboard focus and honors reduced motion before explicit replay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const diagnostics = await openStudio(page);
  await page.locator('.brand').focus();
  await page.keyboard.press('Tab');
  for (let index = 0; index < 6; index++) {
    if (await page.locator('.quote-input').evaluate(element => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(page.locator('.quote-input')).toBeFocused();
  const focus = await page.locator('.quote-input').evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus).toEqual({ visible: true, outline: 'solid', width: '2px' });
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  const resting = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { time: dev.state().time, poster: dev.spec.posterTime };
  });
  expect(resting.time).toBe(resting.poster);
  await page.locator('.replay-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  diagnostics.verify();
});

test('recovers context loss during initial font preparation without orphan objects', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    let scheduled = false;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = getContext.apply(this, args);
      if (!scheduled && args[0] === 'webgl2' && this.closest('.stage')) {
        const extension = (context as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
        if (extension) {
          scheduled = true;
          this.addEventListener('webglcontextlost', () => { this.dataset.testContextLoss = 'lost'; });
          this.addEventListener('webglcontextrestored', () => { this.dataset.testContextLoss = 'restored'; });
          setTimeout(() => extension.loseContext(), 5);
          setTimeout(() => extension.restoreContext(), 500);
        }
      }
      return context;
    } as typeof getContext;
  });
  const diagnostics = await openStudio(page);
  await expect(page.locator('.stage canvas')).toHaveAttribute('data-test-context-loss', 'restored');
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'idle');
  const resources = await page.evaluate(() => {
    const debug = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    debug.seek(4);
    return {
      expected: debug.spec.objects.length,
      tracked: debug.renderer.objectRoots.length,
      world: debug.renderer.world.children.length,
      time: debug.state().time,
    };
  });
  expect(resources.expected).toBeGreaterThan(0);
  expect(resources).toEqual({ expected: resources.expected, tracked: resources.expected, world: resources.expected, time: 4 });
  await createAndPause(page);
  diagnostics.verify();
});

test('directs editable input while preserving every original word, accent, apostrophe, and punctuation', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = "  L’intelligence artificielle ne remplace pas les créateurs.\nElle en cre\u0301e de nouveaux.  ";
  await page.locator('.quote-input').fill(text);
  await createAndPause(page);
  const film = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, analysis: dev.analysis };
  });
  expect(film.spec.sourceText).toBe(text);
  expect(film.spec.inputLanguage).toBe('fr');
  expect(film.analysis?.sourceText).toBe(text);
  expect(film.spec.objects.map(object => object.text)).toEqual(film.analysis?.groups.map(group => group.text));
  expect(film.spec.objects.map(object => object.text).join('').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''));
  for (const group of film.analysis!.groups) expect(text.slice(group.start, group.end)).toBe(group.text);
  await expect(page.locator('#film-transcript')).toHaveText(text.trim());
  await expect(page.locator('#film-transcript')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.quote-input')).toHaveValue(text);
  expect(film.spec.duration).toBeGreaterThanOrEqual(6);
  expect(film.spec.duration).toBeLessThanOrEqual(60);
  const poster = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { empty: await dev.capture(dev.spec.duration), composition: await dev.capture(dev.spec.posterTime!) };
  });
  expect(poster.composition).not.toEqual(poster.empty);
  diagnostics.verify();
});

test('detects text language automatically while keeping interface language independent', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const english = "The future is not what awaits us. It is what we create.";
  await page.locator('[data-locale="fr"]').click();
  await page.locator('.quote-input').fill(english);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(original.sourceText).toBe(english);
  expect(original.inputLanguage).toBe('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('#film-transcript')).toHaveAttribute('lang', 'en');
  await page.locator('[data-locale="en"]').click();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);

  const french = "Et si tout commençait maintenant ?";
  await page.locator('.edit-button').click();
  await page.locator('.quote-input').fill(french);
  await createAndPause(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#film-transcript')).toHaveAttribute('lang', 'fr');
  const next = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(next.sourceText).toBe(french);
  expect(next.inputLanguage).toBe('fr');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.analysis?.requestedLanguage)).toBe('auto');
  await expect(page.locator('[data-input-language]')).toHaveCount(0);
  diagnostics.verify();
});

test('reproduces a seed exactly and gives REMIX a different spatial choreography', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = 'Less noise. More meaning. Make your words impossible to ignore.';
  const original = await page.evaluate(async text => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    await dev.generate(text, 42, 'en');
    return { spec: dev.spec, poster: await dev.capture(dev.spec.posterTime!) };
  }, text);
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, poster: await dev.capture(dev.spec.posterTime!) };
  });
  expect(remixed.spec.sourceText).toBe(text);
  expect(remixed.spec.seed).not.toBe(original.spec.seed);
  expect(remixed.spec.themeId).toBe(original.spec.themeId);
  const signatures = await page.evaluate(async specs => {
    // The director imports bundled fonts: load it through Vite in the browser,
    // rather than asking Playwright's Node loader to parse those binary assets.
    const modulePath = '/src/direction/director.ts';
    const { sceneSignature } = await import(modulePath);
    return specs.map(sceneSignature);
  }, [original.spec, remixed.spec]);
  expect(signatures[1]).not.toBe(signatures[0]);
  expect(remixed.spec.cameraTracks).not.toEqual(original.spec.cameraTracks);
  expect(remixed.poster).not.toEqual(original.poster);
  const reproduced = await page.evaluate(async text => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    await dev.generate(text, 42, 'en');
    return { spec: dev.spec, poster: await dev.capture(dev.spec.posterTime!) };
  }, text);
  expect(reproduced).toEqual(original);
  diagnostics.verify();
});

test('CREATE gives the same quotation fresh choreography and avoids recent motion repeats', async ({ page }) => {
  await page.addInitScript(() => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) { array[0] = 42; return array; }
      return original(array);
    };
  });
  const diagnostics = await openStudio(page);
  const films: SceneSpec[] = [];
  for (let index = 0; index < 4; index++) {
    if (index) await page.locator('.edit-button').click();
    await createAndPause(page);
    films.push(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec));
  }
  expect(new Set(films.map(film => film.seed)).size).toBe(4);
  expect(new Set(films.map(film => film.themeId)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(films.map(film => JSON.stringify(getTheme(film.themeId).colors))).size).toBe(4);
  for (let index = 0; index < films.length; index++) {
    const film = films[index]!;
    expect(film.sourceText).toBe(FUTURE_QUOTE);
    expect(film.generatorVersion).toMatch(/^spatial-grammar-/);
    expect(film.directionStyle).toBeDefined();
    expect(films.slice(Math.max(0, index - 2), index).map(previous => previous.themeId)).not.toContain(film.themeId);
    expect(films.slice(Math.max(0, index - 2), index).map(previous => getThemeFamilyId(previous.themeId))).not.toContain(getThemeFamilyId(film.themeId));
    if (index) {
      const previous = films[index - 1]!.directionStyle!;
      const style = film.directionStyle!;
      const changes = (['entry', 'transition', 'finale'] as const).filter(key => previous[key] !== style[key]);
      expect(changes.length, 'Consecutive films need a visible change in at least two dominant motion choices').toBeGreaterThanOrEqual(2);
      expect(film.cameraTracks).not.toEqual(films[index - 1]!.cameraTracks);
    }
  }
  await page.locator('.replay-button').click();
  await page.locator('.toggle-button').click();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(films.at(-1));
  diagnostics.verify();
});

test('changes color themes while preserving camera paths, seed, and reading order', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    await dev.generate('Make your words impossible to ignore.', 2026, 'en');
    dev.seek(dev.spec.posterTime!);
  });
  const before = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: await dev.capture(dev.spec.posterTime!) };
  });
  await page.locator('button[data-theme="monochrome"]').click();
  await expect(page.locator('button[data-theme="monochrome"]')).toHaveAttribute('aria-pressed', 'true');
  const after = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: await dev.capture(dev.spec.posterTime!) };
  });
  expect(after.spec.themeId).toBe('monochrome');
  expect(after.spec.seed).toBe(before.spec.seed);
  expect(after.spec.objects).toEqual(before.spec.objects);
  expect(after.spec.cameraTracks).toEqual(before.spec.cameraTracks);
  expect(after.state).toEqual(before.state);
  expect(after.image).not.toEqual(before.image);
  diagnostics.verify();
});

for (const scheme of ['dark', 'light'] as const) {
  test(`opens with the OS ${scheme} appearance and matching film palette`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const diagnostics = await openStudio(page);
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme);
    const result = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return {
        themeId: dev.spec.themeId,
        background: getComputedStyle(document.documentElement).backgroundColor,
        chrome: document.querySelector('meta[name="theme-color"]')!.getAttribute('content'),
      };
    });
    expect(result.themeId).toBe(resolveTheme(result.themeId, scheme).id);
    expect(result.themeId).toContain('~');
    expect(result.chrome).toBe(result.background);
    diagnostics.verify();
  });
}

test('keeps manual and automatic palettes through REMIX and changes colors separately', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('button[data-theme="cobalt"]').click();
  await expect(page.locator('button[data-theme="cobalt"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const locked = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(locked.themeId).toBe('cobalt');
  await page.locator('button[data-theme="auto"]').click();
  await expect(page.locator('button[data-theme="auto"]')).toHaveAttribute('aria-pressed', 'true');
  const automatic = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(automatic.themeId).not.toBe(locked.themeId);
  expect(automatic.objects).toEqual(locked.objects);
  expect(automatic.cameraTracks).toEqual(locked.cameraTracks);
  expect(automatic.seed).toBe(locked.seed);
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(remixed.themeId).toBe(automatic.themeId);
  expect(remixed.seed).not.toBe(automatic.seed);
  expect(remixed.cameraTracks).not.toEqual(automatic.cameraTracks);
  await expect(page.locator('button[data-theme="auto"]')).toHaveAttribute('aria-pressed', 'true');
  diagnostics.verify();
});

test('responds live to OS appearance without changing framing, time or manual palette family', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('button[data-theme="orchid"]').click();
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(6.8));
  const before = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: dev.renderer.canvas.toDataURL() };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  const after = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: dev.renderer.canvas.toDataURL() };
  });
  expect(after.spec.themeId).toBe('orchid-light');
  expect(after.spec).toEqual({ ...before.spec, themeId: 'orchid-light' });
  expect(after.state).toEqual(before.state);
  expect(after.image).not.toBe(before.image);
  await expect(page.locator('button[data-theme="orchid"]')).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(before.spec);
  diagnostics.verify();
});

test('retains the generated color variant when the OS appearance changes', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2.7));
  const before = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: await dev.capture(dev.state().time) };
  });
  expect(before.spec.themeId).toMatch(/~1-[\da-f]{8}$/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  const after = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { spec: dev.spec, state: dev.state(), image: await dev.capture(dev.state().time) };
  });
  expect(after.spec.themeId).toBe(`${before.spec.themeId}-light`);
  expect(after.spec).toEqual({ ...before.spec, themeId: after.spec.themeId });
  expect(after.state).toEqual(before.state);
  expect(after.image).not.toBe(before.image);
  await expect(page.locator('button[data-theme="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(before.spec);
  diagnostics.verify();
});

test('random colors creates new backgrounds and inks without changing choreography and avoids recent families', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const films: SceneSpec[] = [];
  for (let index = 0; index < 8; index++) {
    if (index) {
      await page.locator('button[data-theme="auto"]').click();
      await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
    }
    films.push(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec));
  }
  const palettes = films.map(film => getTheme(film.themeId));
  for (const film of films) {
    expect(film.seed).toBe(films[0]!.seed);
    expect(film.objects).toEqual(films[0]!.objects);
    expect(film.cameraTracks).toEqual(films[0]!.cameraTracks);
  }
  expect(new Set(palettes.map(theme => theme.background)).size).toBeGreaterThanOrEqual(7);
  expect(new Set(palettes.map(theme => JSON.stringify(theme.colors))).size).toBe(8);
  for (let index = 1; index < films.length; index++) {
    const recent = films.slice(Math.max(0, index - 2), index).map(film => getThemeFamilyId(film.themeId));
    expect(recent).not.toContain(getThemeFamilyId(films[index]!.themeId));
  }
  diagnostics.verify();
});

test('prepares complete supported emoji sequences from the bundled monochrome font', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = 'Des idées 💡 pour demain. Créons ensemble 👨‍👩‍👧‍👦 👍🏽 🇫🇷 1️⃣ ❤️.';
  await page.locator('.quote-input').fill(text);
  await createAndPause(page);
  const result = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    let emojiTextures = 0;
    let coloredPixels = 0;
    for (const root of dev.renderer.objectRoots) root.traverse(object => {
      const material = (object as unknown as { material?: { map?: { image?: unknown } } }).material;
      if (material?.map?.image instanceof HTMLCanvasElement) {
        emojiTextures++;
        const canvas = material.map.image;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3]! > 16 && Math.max(data[index]!, data[index + 1]!, data[index + 2]!) - Math.min(data[index]!, data[index + 1]!, data[index + 2]!) > 2) coloredPixels++;
        }
      }
    });
    return { source: dev.spec.sourceText, rendered: dev.spec.objects.map(object => object.text).join(' '), emojiTextures, coloredPixels };
  });
  expect(result.source).toBe(text);
  for (const sequence of ['💡', '👨‍👩‍👧‍👦', '👍🏽', '🇫🇷', '1️⃣', '❤️']) expect(result.rendered).toContain(sequence);
  expect(result.emojiTextures).toBe(6);
  expect(result.coloredPixels).toBe(0);
  diagnostics.verify();
});

for (const [name, text, message] of [
  ['empty text', '   ', 'Add a few words'],
  ['uncovered letters', 'Bonjour 你好.', 'This font does not cover'],
  ['uncovered emoji', 'Une nouvelle idée 🫩.', 'These emoji are not covered'],
  ['text requiring more than sixty seconds', 'Make your words impossible to ignore. '.repeat(50), 'more than 60 seconds'],
] as const) {
  test(`reports ${name} without rewriting input or downloading a fallback font`, async ({ page }) => {
    const diagnostics = await openStudio(page);
    const previousSource = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.sourceText);
    await page.locator('[data-locale="en"]').click();
    await page.locator('.quote-input').fill(text);
    await page.locator('.create-button').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('.message')).toContainText(message);
    await expect(page.locator('.quote-input')).toHaveValue(text);
    await expect(page.locator('.create-button')).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.sourceText)).toBe(previousSource);
    diagnostics.verify();
  });
}

test('downloads genuine portrait video twice and restores the preview after each export', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('[data-locale="en"]').click();
  await createAndPause(page);
  const duration = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.duration);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2.7));
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(page.locator('.download-button')).toBeEnabled();
    const downloaded = page.waitForEvent('download');
    await page.locator('.download-button').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
    const download = await downloaded;
    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = await readFile(path!);
    const format = download.suggestedFilename().endsWith('.mp4') ? 'mp4' : 'webm';
    if (format === 'mp4') expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    else expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(bytes.length).toBeGreaterThan(100_000);
    const metadata = await page.evaluate(async ({ data, format }) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const loaded = new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('The downloaded video is not playable.'));
      });
      video.src = `data:video/${format};base64,${data}`;
      await loaded;
      const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      video.removeAttribute('src');
      video.load();
      return result;
    }, { data: bytes.toString('base64'), format });
    expect(metadata.duration).toBeCloseTo(duration, 2);
    expect(metadata.width / metadata.height).toBe(9 / 16);
    expect([1920, 1280]).toContain(metadata.height);
    await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('.export-progress')).toBeHidden();
    await expect(page.locator('.message')).toContainText('Your video is ready.');
    const preview = await page.evaluate(() => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      return { size: dev.renderer.getSize(), time: dev.renderer.lastTime };
    });
    expect(preview).toEqual({ size: [540, 960], time: 2.7 });
  }
  diagnostics.verify();
});

test('names the actual exported film from its source text within 76 characters, including the extension', async ({ page }) => {
  const diagnostics = await openStudio(page);
  const text = 'Créons maintenant : nos idées prennent toute la lumière, dépassent le cadre et donnent enfin une forme à ce que nous imaginons.';
  await page.locator('.quote-input').fill(text);
  await createAndPause(page);
  // Editing an ungenerated draft must not rename the film being exported.
  await page.locator('.edit-button').click();
  await page.locator('.quote-input').fill('Ce brouillon ne doit pas nommer la vidéo précédente.');
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  const filename = download.suggestedFilename();
  const format = filename.endsWith('.mp4') ? 'mp4' : 'webm';
  expect(filename).toBe(videoFilename(text, format));
  expect(filename.length).toBeLessThanOrEqual(76);
  expect(filename.startsWith('Créons maintenant nos idées')).toBe(true);
  const bytes = await readFile((await download.path())!);
  if (format === 'mp4') expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
  else expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});

test('cancels a UI export, re-enables editing, and successfully retries', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('[data-locale="en"]').click();
  await createAndPause(page);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(3.1));
  await page.locator('.download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await expect(page.locator('.remix-button')).toBeDisabled();
  await expect(page.locator('button[data-theme="monochrome"]')).toBeDisabled();
  await page.locator('.cancel-export-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('.message')).toHaveText('Export cancelled.');
  await expect(page.locator('.export-progress')).toBeHidden();
  await expect(page.locator('.edit-button')).toBeEnabled();
  await expect(page.locator('.remix-button')).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.getSize())).toEqual([540, 960]);
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(videoFilename(FUTURE_QUOTE, download.suggestedFilename().endsWith('.mp4') ? 'mp4' : 'webm'));
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.lastTime)).toBe(3.1);
  diagnostics.verify();
});

test('freezes video colors during an OS change and applies the new appearance after export', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const frozenThemeId = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.themeId);
  expect(frozenThemeId).toContain('~');
  await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    dev.seek(2.7);
    const control = window as unknown as { releaseExport?: () => void; exportThemeFrames?: string[] };
    const flush = VideoEncoder.prototype.flush;
    let held = false;
    VideoEncoder.prototype.flush = async function () {
      if (!held) {
        held = true;
        await new Promise<void>(resolve => { control.releaseExport = resolve; });
      }
      return flush.call(this);
    };
    const render = dev.renderer.renderFrame.bind(dev.renderer);
    control.exportThemeFrames = [];
    dev.renderer.renderFrame = (time: number) => {
      if (document.querySelector('.studio')!.getAttribute('data-state') === 'exporting') {
        control.exportThemeFrames!.push((dev.renderer.world.background as { getHexString(): string }).getHexString());
      }
      render(time);
    };
  });
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  await page.waitForFunction(() => Boolean((window as unknown as { releaseExport?: () => void }).releaseExport));
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.themeId)).toBe(frozenThemeId);
  await page.evaluate(() => (window as unknown as { releaseExport: () => void }).releaseExport());
  const filename = (await downloaded).suggestedFilename();
  expect(filename).toBe(videoFilename(FUTURE_QUOTE, filename.endsWith('.mp4') ? 'mp4' : 'webm'));
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  const result = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return {
      colors: (window as unknown as { exportThemeFrames: string[] }).exportThemeFrames,
      themeId: dev.spec.themeId, size: dev.renderer.getSize(), time: dev.state().time,
    };
  });
  expect(result.colors.length).toBeGreaterThan(100);
  expect([...new Set(result.colors)]).toEqual([getTheme(frozenThemeId).background.slice(1).toLowerCase()]);
  expect(result.themeId).toBe(`${frozenThemeId}-light`);
  expect(result.size).toEqual([540, 960]);
  expect(result.time).toBe(2.7);
  diagnostics.verify();
});

test('keeps recorded music with REMIX, synchronizes replay and restores silence on removal', async ({ page }) => {
  await page.addInitScript(() => {
    const starts: number[][] = [];
    Object.assign(window, { __AUDIO_STARTS__: starts });
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this);
      const start = source.start.bind(source);
      source.start = (when = 0, offset = 0, duration?: number) => { starts.push([when, offset, duration ?? 0]); start(when, offset, duration); };
      return source;
    };
  });
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const before = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.audio-button').click();
  await expect(page.locator('.audio-panel')).toBeVisible();
  await page.locator('[data-audio-preset="monkeys-spinning-monkeys"]').click();
  await expect(page.locator('[data-audio-preset="monkeys-spinning-monkeys"]')).toHaveAttribute('aria-pressed', 'true');
  const audio = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    Object.assign(window, { __RECORDED_BUFFER__: dev.audio!.buffer });
    return { duration: dev.audio!.buffer.duration, volume: dev.audio!.volume, spec: dev.spec };
  });
  expect(audio.spec).toEqual(before);
  expect(audio.duration).toBeCloseTo(26.6666667, 1);
  expect(audio.volume).toBe(0.7);
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2.7));
  await page.locator('.toggle-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __AUDIO_STARTS__: number[][] }).__AUDIO_STARTS__.length)).toBeGreaterThan(0);
  await page.locator('.toggle-button').click();
  const starts = await page.evaluate(() => (window as unknown as { __AUDIO_STARTS__: number[][] }).__AUDIO_STARTS__);
  expect(starts[0]![1]).toBeCloseTo(2.7, 5);
  await page.locator('.replay-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __AUDIO_STARTS__: number[][] }).__AUDIO_STARTS__.some(start => start[1] === 0))).toBe(true);
  await page.locator('.toggle-button').click();
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await page.evaluate(() => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    return { seed: dev.spec.seed, audioDuration: dev.audio!.buffer.duration,
      sameBuffer: dev.audio!.buffer === (window as unknown as { __RECORDED_BUFFER__: AudioBuffer }).__RECORDED_BUFFER__ };
  });
  expect(remixed.seed).not.toBe(before.seed);
  expect(remixed.audioDuration).toBe(audio.duration);
  expect(remixed.sameBuffer).toBe(true);
  await expect(page.locator('[data-audio-preset="monkeys-spinning-monkeys"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.audio-remove-button').click();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.audio)).toBeNull();
  await expect(page.locator('.audio-settings')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.audio-panel')).toBeHidden();
  diagnostics.verify();
});

test('imports an excerpt, applies offset and volume, and keeps the exported sound audible after repeated loops', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  await page.locator('.audio-button').click();
  await page.locator('.audio-file').setInputFiles({ name: 'meme-excerpt.wav', mimeType: 'audio/wav', buffer: audioFixture() });
  await expect(page.locator('.audio-source-name')).toHaveText('meme-excerpt.wav');
  await page.locator('.audio-offset').fill('1');
  await page.locator('.audio-offset').dispatchEvent('input');
  await page.locator('.audio-volume').fill('0.25');
  await page.locator('.audio-volume').dispatchEvent('input');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  const selected = await page.evaluate(() => {
    const track = (window as unknown as DebugWindow).__CREACTORS_DEV__.audio!;
    return { offset: track.offset, volume: track.volume, duration: track.buffer.duration };
  });
  expect(selected).toEqual({ offset: 1, volume: 0.25, duration: 2.5 });
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await expect(page.locator('.audio-offset')).toBeDisabled();
  const download = await downloaded;
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const blob = new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))]);
    const input = new media.Input({ source: new media.BlobSource(blob), formats: [media.MP4, media.WEBM] });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('Downloaded film has no audio track.');
      let square = 0, count = 0, loopSquare = 0, loopCount = 0, crossings = 0, previous = 0, lateCrossings = 0, latePrevious = 0;
      const sink = new media.AudioBufferSink(track);
      for await (const chunk of sink.buffers()) {
        const data = chunk.buffer.getChannelData(0);
        for (let index = 0; index < data.length; index++) {
          const time = chunk.timestamp + index / chunk.buffer.sampleRate;
          const value = data[index]!;
          if (time >= 0.2 && time < 0.8) {
            square += value * value; count++;
            if (previous <= 0 && value > 0) crossings++;
            previous = value;
          }
          if (time >= 3.2 && time < 4.2) {
            loopSquare += value * value; loopCount++;
            if (latePrevious <= 0 && value > 0) lateCrossings++;
            latePrevious = value;
          }
        }
      }
      return { rms: Math.sqrt(square / count), loopRms: Math.sqrt(loopSquare / loopCount), frequency: crossings / 0.6, loopFrequency: lateCrossings,
        duration: await input.computeDuration(), codec: await track.getCodec(), sampleRate: await track.getSampleRate() };
    } finally { input.dispose(); }
  }, bytes.toString('base64'));
  expect(report.codec).toBe(download.suggestedFilename().endsWith('.mp4') ? 'aac' : 'opus');
  expect(report.sampleRate).toBe(48000);
  expect(report.duration).toBeCloseTo(Math.ceil(original.duration * 30) / 30, 3);
  expect(report.rms).toBeGreaterThan(0.025);
  expect(report.rms).toBeLessThan(0.045);
  expect(report.frequency).toBeGreaterThan(850);
  expect(report.frequency).toBeLessThan(910);
  expect(report.loopRms).toBeGreaterThan(0.025);
  expect(report.loopRms).toBeLessThan(0.045);
  expect(report.loopFrequency).toBeGreaterThan(850);
  expect(report.loopFrequency).toBeLessThan(910);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  diagnostics.verify();
});

test('rejects invalid audio while retaining the previous selection and keeping mobile controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.emulateMedia({ colorScheme: 'light' });
  const diagnostics = await openStudio(page);
  await page.locator('[data-locale="en"]').click();
  await createAndPause(page);
  await page.locator('.audio-button').click();
  await page.locator('[data-audio-preset="sneaky-snitch"]').click();
  await expect(page.locator('[data-audio-preset="sneaky-snitch"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.audio-file').setInputFiles({ name: 'invalid.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('Invalid audio') });
  await expect(page.locator('.message')).toContainText('could not');
  await expect(page.locator('[data-audio-preset="sneaky-snitch"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.remix-button')).toBeEnabled();
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.audio-panel')!.getBoundingClientRect();
    const canvas = document.querySelector('.stage canvas')!.getBoundingClientRect();
    const targets = [...document.querySelectorAll('.audio-panel button, .audio-panel input[type="range"], .audio-button')].filter(element => (element as HTMLElement).offsetParent !== null)
      .map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
    return { width: document.documentElement.scrollWidth, panel: { left: panel.left, right: panel.right, bottom: panel.bottom }, aspect: canvas.width / canvas.height, targets };
  });
  expect(layout.width).toBe(320);
  expect(layout.panel.left).toBeGreaterThanOrEqual(0);
  expect(layout.panel.right).toBeLessThanOrEqual(320);
  expect(layout.panel.bottom).toBeLessThan(667);
  expect(layout.aspect).toBeCloseTo(9 / 16, 2);
  for (const target of layout.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  diagnostics.verify();
});

test('offers all six recorded tracks with audible local decoding and reusable buffers', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('.audio-button').click();
  await expect(page.locator('[data-audio-preset]')).toHaveCount(6);
  await expect(page.locator('[data-audio-preset="bounce"], [data-audio-preset="suspense"], [data-audio-preset="impact"]')).toHaveCount(0);
  for (const track of builtinAudioTracks) {
    const button = page.locator(`[data-audio-preset="${track.id}"]`);
    await expect(button).toHaveText(track.title);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.audio-source-name')).toHaveText(track.title);
    const decoded = await page.evaluate(id => {
      const selected = (window as unknown as DebugWindow).__CREACTORS_DEV__.audio!;
      const cache = (window as unknown as { __TRACK_BUFFERS__?: Record<string, AudioBuffer> });
      (cache.__TRACK_BUFFERS__ ??= {})[id] = selected.buffer;
      const samples = selected.buffer.getChannelData(0);
      let square = 0;
      for (const value of samples) square += value * value;
      return { rate: selected.buffer.sampleRate, channels: selected.buffer.numberOfChannels,
        duration: selected.buffer.duration, rms: Math.sqrt(square / samples.length), offset: selected.offset, volume: selected.volume };
    }, track.id);
    expect(decoded.rate).toBe(48000);
    expect(decoded.channels).toBeGreaterThanOrEqual(1);
    expect(decoded.channels).toBeLessThanOrEqual(2);
    if (track.license === 'user-provided') {
      expect(decoded.duration).toBeGreaterThan(10);
      expect(decoded.duration).toBeLessThan(20);
    } else {
      expect(decoded.duration).toBeGreaterThanOrEqual(20);
      expect(decoded.duration).toBeLessThanOrEqual(31);
    }
    expect(decoded.rms).toBeGreaterThan(0.005);
    expect(decoded.offset).toBe(0);
    expect(decoded.volume).toBe(0.7);
  }
  await page.locator('[data-audio-preset="monkeys-spinning-monkeys"]').click();
  await expect(page.locator('[data-audio-preset="monkeys-spinning-monkeys"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => {
    const selected = (window as unknown as DebugWindow).__CREACTORS_DEV__.audio!;
    return selected.buffer === (window as unknown as { __TRACK_BUFFERS__: Record<string, AudioBuffer> }).__TRACK_BUFFERS__['monkeys-spinning-monkeys'];
  })).toBe(true);
  diagnostics.verify();
});

test('opens localized audio credits, copies exact attribution, and handles denial with accessible mobile dialog controls', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { copied: '', denied: false };
    Object.assign(window, { __CREDIT_COPY__: state });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text: string) {
      if (state.denied) throw new DOMException('Clipboard is unavailable', 'NotAllowedError');
      state.copied = text;
    } } });
  });
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  await page.locator('.audio-button').click();
  const opener = page.locator('.audio-credits-button'), dialog = page.locator('.audio-credits-dialog');
  await page.locator('[data-audio-preset="monkeys-spinning-monkeys"]').click();
  await expect(page.locator('[data-audio-preset="monkeys-spinning-monkeys"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2.7));
  await expect(opener).toHaveAccessibleName('Audio credits');
  await opener.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('Audio credits');
  await expect(page.locator('.audio-credits-close')).toBeFocused();
  await expect(dialog.locator('[data-audio-credit]')).toHaveCount(6);
  for (const track of builtinAudioTracks) {
    const entry = dialog.locator(`[data-audio-credit="${track.id}"]`);
    await expect(entry).toContainText(track.title);
    if (track.artist) await expect(entry).toContainText(track.artist);
    if (track.licenseUrl) await expect(entry.locator('a').first()).toHaveAttribute('href', track.licenseUrl);
    if (track.sourceUrl) await expect(entry.locator('.audio-credit-source')).toHaveAttribute('href', track.sourceUrl);
    if (track.attributionRequired) await expect(entry.locator('.audio-credit-text')).toHaveValue(track.credit!);
    if (track.license === 'user-provided') {
      await expect(entry.locator('.audio-credit-meta')).toHaveText('Audio supplied by you');
      await expect(entry.locator('.audio-credit-copy, .audio-credit-source, a')).toHaveCount(0);
    }
  }
  await mkdir('artifacts/audio-library', { recursive: true });
  await page.screenshot({ path: 'artifacts/audio-library/credits-desktop-dark.png' });
  const monkeys = builtinAudioTracks.find(track => track.id === 'monkeys-spinning-monkeys')!;
  await page.locator('[data-audio-credit-copy="monkeys-spinning-monkeys"]').click();
  expect(await page.evaluate(() => (window as unknown as { __CREDIT_COPY__: { copied: string } }).__CREDIT_COPY__.copied)).toBe(monkeys.credit);
  await expect(dialog.locator('[data-audio-credit="monkeys-spinning-monkeys"] .audio-credit-status')).toHaveText('Credit copied.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.locator('[data-locale="fr"]').click();
  await page.setViewportSize({ width: 320, height: 667 });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('[data-audio-preset]')).toHaveCount(6);
  const panelLayout = await page.locator('.audio-panel').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, bottom: rect.bottom, width: document.documentElement.scrollWidth,
      buttons: [...element.querySelectorAll<HTMLButtonElement>('[data-audio-preset]')].map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height, top: box.top };
      }) };
  });
  expect(panelLayout.width).toBe(320);
  expect(panelLayout.left).toBeGreaterThanOrEqual(0);
  expect(panelLayout.right).toBeLessThanOrEqual(320);
  expect(panelLayout.bottom).toBeLessThan(667);
  expect(new Set(panelLayout.buttons.map(button => Math.round(button.top))).size).toBe(2);
  for (const button of panelLayout.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(320);
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: 'artifacts/audio-library/panel-phone-light.png' });
  await opener.click();
  await expect(dialog).toHaveAccessibleName('Crédits audio');
  await expect(page.locator('.audio-credits-description')).toContainText('description de votre publication');
  await page.screenshot({ path: 'artifacts/audio-library/credits-phone-light.png' });
  await page.evaluate(() => { (window as unknown as { __CREDIT_COPY__: { denied: boolean } }).__CREDIT_COPY__.denied = true; });
  const sneaky = dialog.locator('[data-audio-credit="sneaky-snitch"]');
  await sneaky.locator('.audio-credit-copy').click();
  await expect(sneaky.locator('.audio-credit-status')).toHaveText('Copiez le texte sélectionné manuellement.');
  await expect(sneaky.locator('.audio-credit-text')).toBeFocused();
  expect(await sneaky.locator('.audio-credit-text').evaluate(element => {
    const field = element as HTMLTextAreaElement;
    return field.value.slice(field.selectionStart, field.selectionEnd);
  })).toBe(builtinAudioTracks.find(track => track.id === 'sneaky-snitch')!.credit);
  const layout = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      scrollWidth: document.documentElement.scrollWidth,
      targets: [...element.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) };
  });
  expect(layout.scrollWidth).toBe(320);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(320);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.bottom).toBeLessThanOrEqual(667);
  for (const target of layout.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  await page.locator('.audio-credits-close').click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  diagnostics.verify();
});

test('decodes the supplied end-credits MP3 locally, unlocks before async decoding, and retains the recorded excerpt through remix and photos', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = [], starts: number[] = [];
    Object.assign(window, { __RECORDED_EVENTS__: events, __RECORDED_STARTS__: starts });
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () { events.push('resume'); return resume.call(this); };
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (bytes, success, failure) {
      events.push('decode'); return decode.call(this, bytes, success, failure);
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this), start = source.start.bind(source);
      source.start = (when = 0, offset = 0, duration?: number) => { starts.push(offset); start(when, offset, duration); };
      return source;
    };
  });
  const diagnostics = await openStudio(page);
  await page.locator('.create-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.audio-button').click();
  await page.locator('[data-audio-preset="meme-de-creditos-finales"]').click();
  await expect(page.locator('[data-audio-preset="meme-de-creditos-finales"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __RECORDED_STARTS__: number[] }).__RECORDED_STARTS__.length)).toBeGreaterThan(0);
  await page.locator('.toggle-button').click();
  const decoded = await page.evaluate(() => {
    const track = (window as unknown as DebugWindow).__CREACTORS_DEV__.audio!;
    const events = (window as unknown as { __RECORDED_EVENTS__: string[] }).__RECORDED_EVENTS__;
    Object.assign(window, { __RECORDED_BUFFER__: track.buffer });
    const samples = track.buffer.getChannelData(0);
    let square = 0;
    for (const value of samples) square += value * value;
    return { rate: track.buffer.sampleRate, channels: track.buffer.numberOfChannels, duration: track.buffer.duration,
      rms: Math.sqrt(square / samples.length), events };
  });
  expect(decoded.rate).toBe(48000);
  expect(decoded.channels).toBeGreaterThanOrEqual(1);
  expect(decoded.channels).toBeLessThanOrEqual(2);
  // The supplied recording is compressed as AAC without inventing missing music.
  expect(decoded.duration).toBeGreaterThan(10.1);
  expect(decoded.duration).toBeLessThan(10.3);
  expect(decoded.rms).toBeGreaterThan(0.02);
  expect(decoded.events.filter(event => event === 'decode')).toHaveLength(1);
  expect(decoded.events.indexOf('resume')).toBeLessThan(decoded.events.indexOf('decode'));

  await page.locator('.audio-offset').fill('1');
  await page.locator('.audio-offset').dispatchEvent('input');
  await page.locator('.audio-volume').fill('0.32');
  await page.locator('.audio-volume').dispatchEvent('input');
  const verifyRecordedTrack = async () => {
    const selected = await page.evaluate(() => {
      const track = (window as unknown as DebugWindow).__CREACTORS_DEV__.audio!;
      return { sameBuffer: track.buffer === (window as unknown as { __RECORDED_BUFFER__: AudioBuffer }).__RECORDED_BUFFER__,
        offset: track.offset, volume: track.volume, decodeCount: (window as unknown as { __RECORDED_EVENTS__: string[] }).__RECORDED_EVENTS__.filter(event => event === 'decode').length };
    });
    expect(selected).toEqual({ sameBuffer: true, offset: 1, volume: 0.32, decodeCount: 1 });
    await expect(page.locator('[data-audio-preset="meme-de-creditos-finales"]')).toHaveAttribute('aria-pressed', 'true');
  };
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  await verifyRecordedTrack();
  await page.locator('.audio-button').click();
  await page.locator('.image-file').setInputFiles({ name: 'ending.png', mimeType: 'image/png', buffer: await imageFixture(page) });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await verifyRecordedTrack();
  await page.locator('.image-remove-button[data-image-index="0"]:visible').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '0');
  await verifyRecordedTrack();
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(0.5));
  const startCount = await page.evaluate(() => (window as unknown as { __RECORDED_STARTS__: number[] }).__RECORDED_STARTS__.length);
  await page.locator('.toggle-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __RECORDED_STARTS__: number[] }).__RECORDED_STARTS__.length)).toBeGreaterThan(startCount);
  expect(await page.evaluate(index => (window as unknown as { __RECORDED_STARTS__: number[] }).__RECORDED_STARTS__[index], startCount)).toBeCloseTo(0.5, 5);
  await page.locator('.toggle-button').click();
  await page.locator('.replay-button').click();
  await expect.poll(() => page.evaluate(index => (window as unknown as { __RECORDED_STARTS__: number[] }).__RECORDED_STARTS__.slice(index).some(offset => offset === 0), startCount)).toBe(true);
  await page.locator('.toggle-button').click();
  diagnostics.verify();
});

for (const { id, title } of builtinAudioTracks.filter(track => track.id === 'oh-no' || track.id === 'monkeys-spinning-monkeys' || track.id === 'meme-de-creditos-finales')) {
test(`exports ${title} as native AAC matching the selected recording and excerpt settings`, async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make it happen.');
  await createAndPause(page);
  await page.locator('.audio-button').click();
  await page.locator(`[data-audio-preset="${id}"]`).click();
  await expect(page.locator(`[data-audio-preset="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.audio-offset').fill('1');
  await page.locator('.audio-offset').dispatchEvent('input');
  await page.locator('.audio-volume').fill('0.25');
  await page.locator('.audio-volume').dispatchEvent('input');
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__, selected = dev.audio!;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const blob = new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))]);
    const input = new media.Input({ source: new media.BlobSource(blob), formats: [media.MP4] });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('The recorded-music film has no audio track.');
      const rate = 48000, frames = 2 * rate, decoded = new Float32Array(frames);
      for await (const chunk of new media.AudioBufferSink(track).buffers()) {
        const samples = chunk.buffer.getChannelData(0), start = Math.round(chunk.timestamp * rate);
        for (let index = Math.max(0, -start); index < samples.length && start + index < frames; index++) decoded[start + index] = samples[index]!;
        if (start + samples.length >= frames) break;
      }
      const source = selected.buffer.getChannelData(0), first = Math.round(0.3 * rate), last = Math.round(1.8 * rate);
      let bestCorrelation = -1, bestLag = 0, decodedSquare = 0, referenceSquare = 0;
      for (let index = first; index < last; index++) {
        const reference = source[Math.round(selected.offset * rate) + index]! * selected.volume;
        decodedSquare += decoded[index]! ** 2; referenceSquare += reference ** 2;
      }
      // AAC includes encoder priming. Search the bounded codec delay, then
      // refine to the sample: the waveform must still be this recording.
      const correlate = (lag: number, stride: number) => {
        let product = 0, aSquare = 0, bSquare = 0;
        for (let index = first; index < last; index += stride) {
          const a = decoded[index]!, b = source[Math.round(selected.offset * rate) + index + lag]! * selected.volume;
          product += a * b; aSquare += a * a; bSquare += b * b;
        }
        return product / Math.sqrt(aSquare * bSquare);
      };
      for (let lag = -4096; lag <= 4096; lag += 16) {
        const correlation = correlate(lag, 16);
        if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
      }
      const coarseLag = bestLag;
      for (let lag = coarseLag - 16; lag <= coarseLag + 16; lag++) {
        const correlation = correlate(lag, 2);
        if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag; }
      }
      return { codec: await track.getCodec(), rate: await track.getSampleRate(), duration: await input.computeDuration(),
        filmDuration: Math.ceil(dev.spec.duration * 30) / 30, rms: Math.sqrt(decodedSquare / (last - first)),
        gainRatio: Math.sqrt(decodedSquare / referenceSquare), correlation: bestCorrelation, codecDelaySamples: bestLag };
    } finally { input.dispose(); }
  }, bytes.toString('base64'));
  await testInfo.attach(`${id}-aac-waveform`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.codec).toBe('aac');
  expect(report.rate).toBe(48000);
  expect(report.duration).toBeCloseTo(report.filmDuration, 3);
  expect(report.rms).toBeGreaterThan(0.01);
  expect(report.gainRatio).toBeGreaterThan(0.75);
  expect(report.gainRatio).toBeLessThan(1.25);
  expect(report.correlation).toBeGreaterThan(0.85);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  diagnostics.verify();
});
}

test('renders a sixty-second native Web Audio preview with the same seamless repeated samples as export', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  const report = await page.evaluate(async () => {
    const playerModule = '/src/audio/player.ts', samplingModule = '/src/audio/sampling.ts';
    const [{ AudioPlayer }, { renderAudioChunk }] = await Promise.all([import(playerModule), import(samplingModule)]);
    const rate = 48000, duration = 60, context = new OfflineAudioContext(2, rate * duration, rate);
    const buffer = context.createBuffer(2, Math.round(3.7 * rate), rate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let frame = 0; frame < samples.length; frame++) {
        const time = frame / rate;
        samples[frame] = 0.32 * Math.sin(2 * Math.PI * (channel ? 659 : 443) * time)
          + 0.12 * Math.sin(2 * Math.PI * (channel ? 227 : 137) * time);
      }
    }
    const track = { buffer, offset: 0.4, volume: 0.5 };
    const nativeConstructor = window.AudioContext;
    Object.defineProperty(context, 'resume', { value: () => Promise.resolve() });
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: function () { return context; } });
    const player = new AudioPlayer();
    try {
      player.setTrack(track, duration);
      await player.play(0, duration);
      const rendered = await context.startRendering();
      const expected = renderAudioChunk(track, 0, rendered.length, rendered.length, rate);
      const perChannel = expected.map((reference: Float32Array, channel: number) => {
        const actual = rendered.getChannelData(channel);
        let squaredError = 0, squaredReference = 0, lastSquared = 0, lastFrames = 0, maximumError = 0, seamStep = 0;
        for (let frame = 0; frame < reference.length; frame++) {
          const error = actual[frame]! - reference[frame]!;
          squaredError += error ** 2; squaredReference += reference[frame]! ** 2;
          maximumError = Math.max(maximumError, Math.abs(error));
          if (frame >= 58 * rate && frame < 59 * rate) { lastSquared += actual[frame]! ** 2; lastFrames++; }
          if (frame > 3.25 * rate && frame < 3.34 * rate) seamStep = Math.max(seamStep, Math.abs(actual[frame]! - actual[frame - 1]!));
        }
        const original = buffer.getChannelData(channel);
        const hardSpliceStep = Math.abs(original.at(-1)! - original[Math.round(track.offset * rate)]!) * track.volume;
        return { relativeError: Math.sqrt(squaredError / squaredReference), maximumError, lastRms: Math.sqrt(lastSquared / lastFrames), seamStep, hardSpliceStep };
      });
      return { duration: rendered.duration, channels: rendered.numberOfChannels, perChannel };
    } finally {
      player.pause();
      Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: nativeConstructor });
    }
  });
  await testInfo.attach('native-preview-loop-60s', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.duration).toBe(60);
  expect(report.channels).toBe(2);
  for (const channel of report.perChannel) {
    expect(channel.relativeError).toBeLessThan(0.002);
    expect(channel.maximumError).toBeLessThan(0.005);
    expect(channel.lastRms).toBeGreaterThan(0.08);
    expect(channel.seamStep).toBeLessThan(0.05);
  }
  expect(report.perChannel[1]!.hardSpliceStep).toBeGreaterThan(0.2);
  expect(report.perChannel[1]!.seamStep).toBeLessThan(report.perChannel[1]!.hardSpliceStep / 5);
  diagnostics.verify();
});

for (const id of ['monkeys-spinning-monkeys', 'meme-de-creditos-finales'] as const) {
test(`keeps ${id} audible and correctly repeated in a generated long MP4 after its source ends`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  const text = Array(8).fill('Make your words move across the world.').join(' ');
  const original = await page.evaluate(async text => (window as unknown as DebugWindow).__CREACTORS_DEV__.generate(text, 21437, 'en'), text);
  expect(original.duration).toBeGreaterThan(30);
  expect(original.duration).toBeLessThanOrEqual(60);
  await page.locator('.audio-button').click();
  await page.locator(`[data-audio-preset="${id}"]`).click();
  await expect(page.locator(`[data-audio-preset="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.audio-offset').fill('1');
  await page.locator('.audio-offset').dispatchEvent('input');
  await page.locator('.audio-volume').fill('0.25');
  await page.locator('.audio-volume').dispatchEvent('input');
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__, selected = dev.audio!;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))])), formats: [media.MP4] });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('Long MP4 has no audio track.');
      const rate = 48000, decoded = new Float32Array(Math.ceil(dev.spec.duration * rate));
      for await (const chunk of new media.AudioBufferSink(track).buffers()) {
        const samples = chunk.buffer.getChannelData(0), start = Math.round(chunk.timestamp * rate);
        for (let index = Math.max(0, -start); index < samples.length && start + index < decoded.length; index++) decoded[start + index] = samples[index]!;
      }
      const source = selected.buffer.getChannelData(0), offsetFrames = Math.round(selected.offset * rate);
      const segmentFrames = source.length - offsetFrames;
      // Independently reconstruct the repeat phase outside the twenty-millisecond
      // crossfade. This proves the late audio is the selected recording and offset.
      const period = segmentFrames - Math.min(Math.round(0.02 * rate), Math.floor(segmentFrames / 4));
      const windows = [period / rate + 0.45, dev.spec.duration - 1.8].map(startTime => {
        const first = Math.round(startTime * rate), last = Math.min(decoded.length, first + rate);
        const referenceAt = (index: number) => source[offsetFrames + ((index % period) + period) % period]! * selected.volume;
        const correlate = (lag: number, stride: number) => {
          let product = 0, aSquare = 0, bSquare = 0;
          for (let index = first; index < last; index += stride) {
            // Omit a splice if this one-second late window happens to cross one.
            const phase = ((index + lag) % period + period) % period;
            if (phase < rate * 0.04 || phase > period - rate * 0.04) continue;
            const a = decoded[index]!, b = referenceAt(index + lag);
            product += a * b; aSquare += a * a; bSquare += b * b;
          }
          return { correlation: product / Math.sqrt(aSquare * bSquare), rms: Math.sqrt(aSquare / ((last - first) / stride)), gain: Math.sqrt(aSquare / bSquare) };
        };
        let bestLag = 0, best = correlate(0, 16);
        for (let lag = -4096; lag <= 4096; lag += 16) {
          const result = correlate(lag, 16);
          if (result.correlation > best.correlation) { best = result; bestLag = lag; }
        }
        const coarseLag = bestLag;
        for (let lag = coarseLag - 16; lag <= coarseLag + 16; lag++) {
          const result = correlate(lag, 2);
          if (result.correlation > best.correlation) { best = result; bestLag = lag; }
        }
        return { startTime, ...best, codecDelaySamples: bestLag };
      });
      return { codec: await track.getCodec(), rate: await track.getSampleRate(), duration: await input.computeDuration(), filmDuration: Math.ceil(dev.spec.duration * 30) / 30, sourceDuration: selected.buffer.duration, windows };
    } finally { input.dispose(); }
  }, bytes.toString('base64'));
  await testInfo.attach(`${id}-long-loop-aac`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.codec).toBe('aac');
  expect(report.rate).toBe(48000);
  expect(report.duration).toBeCloseTo(report.filmDuration, 3);
  expect(report.filmDuration).toBeGreaterThan(report.sourceDuration + 2);
  for (const window of report.windows) {
    expect(window.rms).toBeGreaterThan(0.006);
    expect(window.gain).toBeGreaterThan(0.75);
    expect(window.gain).toBeLessThan(1.25);
    expect(window.correlation).toBeGreaterThan(0.85);
  }
  diagnostics.verify();
});
}

test('imports uncropped final images, animates them from depth, and preserves them through remix, palette and locale changes', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  const fixtures = [
    ['landscape.png', 'image/png', 600, 400],
    ['portrait.jpg', 'image/jpeg', 400, 600],
    ['landscape.webp', 'image/webp', 600, 400],
  ] as const;
  const files = [];
  for (const [name, mimeType, width, height] of fixtures) files.push({ name, mimeType, buffer: await imageFixture(page, width, height, mimeType) });
  await page.locator('.image-file').setInputFiles(files);
  await page.waitForFunction(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.finalImages?.length === 3);
  for (const [index, [name, _mimeType, width, height]] of fixtures.entries()) {
    await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'true');
    const result = await page.evaluate(async index => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      const image = dev.spec.finalImages![index]!;
      const hold = (image.entrance.end + image.exit.start) / 2;
      dev.seek(image.visibleInterval[0] - 1 / 30);
      const before = dev.state().finalImages![index]!;
      const arrivalWidths = [0.2, 0.6, 1].map(progress => {
        dev.seek(image.entrance.start + (image.entrance.end - image.entrance.start) * progress);
        const box = dev.bounds().find(box => box.id === image.id)!;
        return box.max[0]! - box.min[0]!;
      });
      dev.seek(hold);
      const direct = structuredClone(dev.state());
      const box = dev.bounds().find(box => box.id === image.id)!;
      for (const time of [0, dev.spec.duration, 2, image.exit.end, hold]) dev.seek(time);
      const revisited = dev.state();
      const capture = await dev.capture(hold);
      const bitmap = new Image(); bitmap.src = capture; await bitmap.decode();
      const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 256;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0, 144, 256);
      const pixels = context.getImageData(0, 0, 144, 256).data;
      const colors = { green: 0, red: 0, blue: 0, yellow: 0 };
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index]!, g = pixels[index + 1]!, b = pixels[index + 2]!;
        if (r < 55 && g > 200 && b < 55) colors.green++;
        if (r > 200 && g < 55 && b < 55) colors.red++;
        if (r < 55 && g < 55 && b > 200) colors.blue++;
        if (r > 200 && g > 200 && b < 55) colors.yellow++;
      }
      return { image, duration: dev.spec.duration, lastExit: dev.spec.finalImages!.at(-1)!.exit.end, before, direct, revisited, box, arrivalWidths, colors, capture,
        empty: await dev.capture(0), final: await dev.capture(dev.spec.duration - 1 / 30) };
    }, index);
    expect(result.image.asset.source).toMatch(/^data:image\/png;base64,/);
    expect(result.image.asset.width / result.image.asset.height).toBeCloseTo(width / height, 8);
    expect(result.image.width / result.image.height).toBeCloseTo(width / height, 8);
    expect(result.image.baseDuration).toBe(original.duration);
    expect(result.duration).toBeLessThan(original.duration + fixtures.length * 2);
    expect(result.duration - result.lastExit, 'Only a short empty frame is needed at the loop seam').toBeGreaterThanOrEqual(1 / 30);
    expect(result.duration - result.lastExit).toBeLessThanOrEqual(0.2);
    expect(result.before.visible).toBe(false);
    expect(result.direct.finalImages![index]!.visible).toBe(true);
    expect(result.revisited).toEqual(result.direct);
    expect(result.arrivalWidths[1]).toBeGreaterThan(result.arrivalWidths[0]!);
    expect(result.arrivalWidths[2]).toBeGreaterThan(result.arrivalWidths[1]!);
    expect(result.box.min[0]).toBeGreaterThanOrEqual(-0.83);
    expect(result.box.max[0]).toBeLessThanOrEqual(0.83);
    expect(result.box.min[1]).toBeGreaterThanOrEqual(-0.65);
    expect(result.box.max[1]).toBeLessThanOrEqual(0.65);
    for (const pixels of Object.values(result.colors)) expect(pixels, 'All four image corners must survive contain-fit').toBeGreaterThan(100);
    expect(result.final).toEqual(result.empty);
    await testInfo.attach(`final-image-${name}`, { body: Buffer.from(result.capture.split(',')[1]!, 'base64'), contentType: 'image/png' });
  }
  const selected = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.finalImages!.map(image => image.asset));
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(remixed.seed).not.toBe(original.seed);
  expect(remixed.finalImages!.map(image => image.asset)).toEqual(selected);
  expect(remixed.duration).toBeLessThan(remixed.finalImages![0]!.baseDuration + selected.length * 2);
  expect(remixed.duration).toBeGreaterThan(remixed.finalImages!.at(-1)!.exit.end);
  await page.locator('button[data-theme="monochrome"]').click();
  const recolored = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(recolored.finalImages).toEqual(remixed.finalImages);
  await page.locator('[data-locale="fr"]').click();
  await expect(page.locator('.image-film-button')).toHaveAccessibleName('Ajouter des images finales');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(recolored);
  diagnostics.verify();
});

test('bridges the complete quotation into the first photo without an internal empty frame across every finale style', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  const text = 'Less noise. More meaning. Make your words impossible to ignore.';
  const fixtures = [
    { text: FUTURE_QUOTE, seed: 20261009, language: 'fr' as const, style: 'authored' },
    { text, seed: 1, language: 'en' as const, style: 'staggered-punch' },
    { text, seed: 2, language: 'en' as const, style: 'converging-slam' },
    { text, seed: 4, language: 'en' as const, style: 'fan-out' },
    { text, seed: 5, language: 'en' as const, style: 'vortex' },
    { text, seed: 6, language: 'en' as const, style: 'straight-rush' },
    { text: 'Less noise. More meaning.', seed: 4, language: 'en' as const, style: 'fan-out' },
  ];
  const fixtureImage = await imageFixture(page, 600, 800);
  const contacts: string[] = [];
  await mkdir('artifacts/bridge', { recursive: true });
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    if (fixtureIndex) {
      await page.locator('.image-remove-button[data-image-index="0"]:visible').click();
      await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'false');
    }
    const original = await page.evaluate(async fixture => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      await dev.generate(fixture.text, fixture.seed, fixture.language);
      const spec = structuredClone(dev.spec);
      const poster = spec.cameraTracks.find(track => track.id === 'poster' || track.id === 'final-composition')!;
      const readingStates = spec.objects.map(object => {
        dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
        return { camera: dev.state().camera, objects: dev.state().objects };
      });
      dev.seek((poster.start + poster.end) / 2);
      return { spec, readingStates, poster: dev.renderer.canvas.toDataURL('image/png') };
    }, fixture);
    expect(original.spec.directionStyle?.finale ?? 'authored').toBe(fixture.style);
    await page.locator('.image-file').setInputFiles({ name: `${fixture.style}.png`, mimeType: 'image/png', buffer: fixtureImage });
    await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'true');
    const report = await page.evaluate(({ style }) => {
      const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
      const spec = dev.spec, image = spec.finalImages![0]!;
      const poster = spec.cameraTracks.find(track => track.id === 'poster' || track.id === 'final-composition')!;
      const lastTextExit = Math.max(...spec.objects.map(object => object.exit!.end));
      const readingStates = spec.objects.map(object => {
        dev.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
        return { camera: dev.state().camera, objects: dev.state().objects };
      });
      dev.seek((poster.start + poster.end) / 2);
      const posterFrame = dev.renderer.canvas.toDataURL('image/png');
      const sample = document.createElement('canvas'); sample.width = 72; sample.height = 128;
      const context = sample.getContext('2d', { willReadFrequently: true })!;
      dev.seek(0); context.drawImage(dev.renderer.canvas, 0, 0, 72, 128);
      const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
      const frames = [];
      for (let frame = Math.ceil(poster.end * spec.fps); frame <= Math.floor(image.exit.start * spec.fps); frame++) {
        const time = frame / spec.fps;
        dev.seek(time);
        context.drawImage(dev.renderer.canvas, 0, 0, 72, 128);
        const pixels = context.getImageData(0, 0, 72, 128).data;
        let visiblePixels = 0, photoPixels = 0;
        for (let pixel = 0; pixel < pixels.length; pixel += 4) {
          const r = pixels[pixel]!, g = pixels[pixel + 1]!, b = pixels[pixel + 2]!;
          if ([0, 1, 2].some(channel => Math.abs(pixels[pixel + channel]! - background[channel]!) > 8)) visiblePixels++;
          if ((r < 55 && g > 200 && b < 55) || (r < 55 && g < 55 && b > 200) || (r > 200 && g > 200 && b < 55)) photoPixels++;
        }
        frames.push({ time, visiblePixels, photoPixels });
      }
      const sheet = document.createElement('canvas'); sheet.width = 1080; sheet.height = 348;
      const sheetContext = sheet.getContext('2d')!;
      sheetContext.fillStyle = '#15151e'; sheetContext.fillRect(0, 0, sheet.width, sheet.height);
      const points = [poster.end - 0.1, poster.end + 0.15, poster.end + 0.35, poster.end + 0.55, lastTextExit, image.exit.start - 1 / spec.fps];
      for (const [column, time] of points.entries()) {
        dev.seek(time);
        sheetContext.drawImage(dev.renderer.canvas, column * 180, 28, 180, 320);
        sheetContext.fillStyle = '#ffffff'; sheetContext.font = '12px sans-serif';
        sheetContext.fillText(`${style} · ${time.toFixed(2)} s`, column * 180 + 5, 19);
      }
      return { spec, readingStates, posterFrame, lastTextExit,
        emptyFrames: frames.filter(frame => frame.visiblePixels < 20),
        afterText: frames.filter(frame => frame.time >= lastTextExit - 1e-8),
        contact: sheet.toDataURL('image/png') };
    }, fixture);
    const contactBytes = Buffer.from(report.contact.split(',')[1]!, 'base64');
    await writeFile(`artifacts/bridge/${fixture.style}${fixture.text === 'Less noise. More meaning.' ? '-short' : ''}.png`, contactBytes);
    await testInfo.attach(`text-to-photo-${fixture.style}`, { body: contactBytes, contentType: 'image/png' });
    const image = report.spec.finalImages![0]!;
    expect(report.spec.objects, 'Adding a photo must preserve every reading interval and text trajectory').toEqual(original.spec.objects);
    expect(report.spec.cameraTracks.slice(0, original.spec.cameraTracks.length)).toEqual(original.spec.cameraTracks);
    expect(report.readingStates).toEqual(original.readingStates);
    expect(report.posterFrame, 'The brief complete quotation remains unobstructed before its exit').toEqual(original.poster);
    expect(image.entrance.start).toBeLessThan(original.spec.duration);
    expect(image.entrance.start).toBeGreaterThanOrEqual(original.spec.cameraTracks.find(track => track.id === 'poster' || track.id === 'final-composition')!.end - 1e-8);
    expect(image.exit.start - report.lastTextExit, 'The first photo must remain readable after the last text has actually left').toBeGreaterThanOrEqual(0.45 - 1e-8);
    expect(report.emptyFrames, `${fixture.style}: only the closing video seam may have a blank background`).toEqual([]);
    expect(report.afterText.length).toBeGreaterThanOrEqual(13);
    for (const frame of report.afterText) expect(frame.photoPixels, `${fixture.style} at ${frame.time}s: a useful photo must replace the departing text`).toBeGreaterThan(250);
    contacts.push(report.contact);
  }
  const contact = await page.evaluate(async sources => {
    const sheet = document.createElement('canvas'); sheet.width = 1080; sheet.height = sources.length * 348;
    const context = sheet.getContext('2d')!;
    for (const [index, source] of sources.entries()) {
      const image = new Image(); image.src = source; await image.decode(); context.drawImage(image, 0, index * 348);
    }
    return sheet.toDataURL('image/png');
  }, contacts);
  const bytes = Buffer.from(contact.split(',')[1]!, 'base64');
  await writeFile('artifacts/bridge/text-to-photo.png', bytes);
  await testInfo.attach('text-to-photo-all-finales', { body: bytes, contentType: 'image/png' });
  diagnostics.verify();
});

test('overlaps consecutive photos so each lens crossing already reveals the next image', async ({ page }, testInfo) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make it happen.');
  await createAndPause(page);
  const encoded = await page.evaluate(() => ['#ff6d90', '#81e4fc', '#ffc593'].map((color, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 800;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 600, 800);
    context.fillStyle = '#111126'; context.textAlign = 'center'; context.font = 'bold 260px sans-serif';
    context.fillText(String(index + 1), 300, 475);
    return canvas.toDataURL('image/png').split(',')[1]!;
  }));
  await page.locator('.image-file').setInputFiles(encoded.map((source, index) => ({
    name: `ordered-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(source, 'base64'),
  })));
  await page.waitForFunction(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.finalImages?.length === 3);
  const report = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const images = dev.spec.finalImages!;
    const sample = document.createElement('canvas'); sample.width = 72; sample.height = 128;
    const context = sample.getContext('2d', { willReadFrequently: true })!;
    dev.seek(0); context.drawImage(dev.renderer.canvas, 0, 0, 72, 128);
    const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const handoffs = [];
    const sheet = document.createElement('canvas'); sheet.width = 1080; sheet.height = 2 * 348;
    const sheetContext = sheet.getContext('2d')!;
    sheetContext.fillStyle = '#15151e'; sheetContext.fillRect(0, 0, sheet.width, sheet.height);
    for (let index = 0; index < images.length - 1; index++) {
      const previous = images[index]!, next = images[index + 1]!;
      const frames = [];
      for (let frame = Math.floor(previous.exit.start * dev.spec.fps); frame <= Math.ceil((previous.exit.end + 1 / dev.spec.fps) * dev.spec.fps); frame++) {
        const time = frame / dev.spec.fps;
        dev.seek(time);
        const state = dev.state(), bounds = dev.bounds();
        const objects = state.finalImages!.map(object => {
          const depth = dev.renderer.camera.worldToLocal(dev.renderer.camera.position.clone().fromArray(object.position)).z;
          const box = bounds.find(box => box.id === object.id)!;
          const visibleWidth = Math.max(0, Math.min(1, box.max[0]!) - Math.max(-1, box.min[0]!)) / 2;
          const visibleHeight = Math.max(0, Math.min(1, box.max[1]!) - Math.max(-1, box.min[1]!)) / 2;
          return { id: object.id, depth, useful: object.visible && depth < -0.05 && Math.max(visibleWidth, visibleHeight) >= 0.16 };
        });
        context.drawImage(dev.renderer.canvas, 0, 0, 72, 128);
        const pixels = context.getImageData(0, 0, 72, 128).data;
        let visiblePixels = 0;
        for (let pixel = 0; pixel < pixels.length; pixel += 4) {
          if ([0, 1, 2].some(channel => Math.abs(pixels[pixel + channel]! - background[channel]!) > 8)) visiblePixels++;
        }
        frames.push({ time, objects, visiblePixels });
      }
      const crossing = frames.find(frame => frame.objects.find(object => object.id === previous.id)!.depth >= 0)!;
      let longestGap = 0, gap = 0;
      for (const frame of frames) {
        gap = frame.objects.some(object => object.useful) ? 0 : gap + 1 / dev.spec.fps;
        longestGap = Math.max(longestGap, gap);
      }
      handoffs.push({ previous: previous.id, next: next.id, crossing, longestGap, emptyFrames: frames.filter(frame => frame.visiblePixels < 20) });
      for (const [column, offset] of [-0.1, 0.15, 0.3, 0.45, 0.6, 0.8].entries()) {
        const time = previous.exit.start + offset;
        dev.seek(time);
        sheetContext.drawImage(dev.renderer.canvas, column * 180, index * 348 + 28, 180, 320);
        sheetContext.fillStyle = '#ffffff'; sheetContext.font = '14px sans-serif';
        sheetContext.fillText(`${index + 1} → ${index + 2} · ${time.toFixed(2)} s`, column * 180 + 8, index * 348 + 19);
      }
    }
    return { handoffs, order: images.map(image => image.asset.name), contact: sheet.toDataURL('image/png'),
      first: await dev.capture(0), last: await dev.capture(dev.spec.duration - 1 / dev.spec.fps) };
  });
  expect(report.order).toEqual(['ordered-1.png', 'ordered-2.png', 'ordered-3.png']);
  for (const handoff of report.handoffs) {
    expect(handoff.crossing, `${handoff.previous} must physically pass the camera`).toBeDefined();
    expect(handoff.crossing.objects.find(object => object.id === handoff.next)!.useful, 'The next image must already have a useful on-screen size as the previous image clears the lens').toBe(true);
    expect(handoff.longestGap, 'Consecutive images must not leave a perceptible empty pause').toBeLessThanOrEqual(0.15);
    expect(handoff.emptyFrames, 'Actual rendered pixels must remain visible throughout the handoff').toEqual([]);
  }
  expect(report.last).toEqual(report.first);
  const contact = Buffer.from(report.contact.split(',')[1]!, 'base64');
  await mkdir('artifacts/pacing', { recursive: true });
  await writeFile('artifacts/pacing/photo-handoffs.png', contact);
  await testInfo.attach('photo-handoffs', { body: contact, contentType: 'image/png' });
  diagnostics.verify();
});

test('accepts five ordered photos, rejects invalid additions, restores the film on removal, and fits phone controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 667 });
  await page.emulateMedia({ colorScheme: 'light' });
  const diagnostics = await openStudio(page);
  await createAndPause(page);
  const original = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  const fixture = await imageFixture(page);
  const six = Array.from({ length: 6 }, (_, index) => ({ name: `photo-${index}.png`, mimeType: 'image/png', buffer: fixture }));
  await page.locator('.image-file').setInputFiles(six);
  await expect(page.locator('.message')).toContainText('5');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  await page.locator('.image-file').setInputFiles(six.slice(0, 5));
  await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'true');
  const selected = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(selected.finalImages!.map(image => image.asset.name)).toEqual(six.slice(0, 5).map(file => file.name));
  expect(selected.duration).toBeLessThan(original.duration + 10);
  expect(selected.duration).toBeGreaterThan(selected.finalImages!.at(-1)!.exit.end);
  // Make a slot before checking failed decode; the add button is capped at five.
  await page.locator('.image-remove-button[data-image-index="2"]:visible').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '4');
  const four = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(four.finalImages!.map(image => image.asset.name)).toEqual(['photo-0.png', 'photo-1.png', 'photo-3.png', 'photo-4.png']);
  expect(four.duration).toBeLessThan(selected.duration);
  expect(four.duration).toBeGreaterThan(four.finalImages!.at(-1)!.exit.end);
  for (const invalid of [
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('Not an image') },
    { name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>') },
  ]) {
    await page.locator('.image-file').setInputFiles(invalid);
    await expect(page.locator('.message')).toContainText('could not be read');
    expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(four);
    await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'true');
    await expect(page.locator('.remix-button')).toBeEnabled();
  }
  const layout = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.image-film-button, .image-remove-button')].filter(button => (button as HTMLElement).offsetParent !== null);
    return { width: document.documentElement.scrollWidth, buttons: buttons.map(button => {
      const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    }) };
  });
  expect(layout.width).toBeLessThanOrEqual(320);
  for (const box of layout.buttons) {
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(320);
  }
  for (let index = 0; index < 4; index++) {
    await page.locator('.image-remove-button[data-image-index="0"]:visible').click();
    await expect(page.locator('.studio')).toHaveAttribute('data-image-count', String(3 - index));
  }
  await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'false');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec)).toEqual(original);
  diagnostics.verify();
});

test('imports animated GIF patches before CREATE with variable delays, transparency and disposal', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Go.');
  await page.locator('.image-file').setInputFiles({ name: 'patches.gif', mimeType: 'image/gif', buffer: disposalGifFixture() });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await expect(page.locator('.studio')).toHaveAttribute('data-has-film', 'false');
  await createAndPause(page);
  const report = await page.evaluate(async () => {
    const asset = (window as unknown as DebugWindow).__CREACTORS_DEV__.spec.finalImages![0]!.asset;
    if (!asset.animation) throw new Error('The imported GIF lost its animation.');
    const frames = [];
    for (const frame of asset.animation.frames) {
      const image = new Image(); image.src = frame.source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      frames.push({ end: frame.end, pixels: [[8, 8], [24, 8], [8, 24], [24, 24], [4, 24]].map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data]) });
    }
    return { duration: asset.animation.duration, width: asset.width, height: asset.height,
      firstSource: asset.source === asset.animation.frames[0]!.source, frames };
  });
  expect(report).toMatchObject({ duration: 1.4, width: 32, height: 32, firstSource: true });
  expect(report.frames.map(frame => frame.end)).toEqual([0.2, 0.5, 0.9, 1.4]);
  const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
  expect(report.frames.map(frame => frame.pixels)).toEqual([
    [red, red, red, red, red],
    [green, red, red, red, red],
    [red, red, red, blue, red],
    [red, red, green, [0, 0, 0, 0], red],
  ]);
  diagnostics.verify();
});

test('treats a single-frame GIF as a still photo despite a long frame delay', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Go.');
  await page.locator('.image-file').setInputFiles({ name: 'still.gif', mimeType: 'image/gif', buffer: singleFrameGifFixture() });
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '1');
  await createAndPause(page);
  const spec = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  const image = spec.finalImages![0]!;
  expect(image.asset.animation).toBeUndefined();
  expect(image.asset.source).toMatch(/^data:image\/png;base64,/);
  expect(spec.duration - image.baseDuration).toBeLessThan(2);
  await expect(page.locator('.image-gif-badge')).toHaveCount(0);
  diagnostics.verify();
});

test('keeps a mixed photo and animated GIF ending deterministic through seek, pause, replay, remix and removal', async ({ page }, testInfo) => {
  await page.clock.install();
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make it happen.');
  const still = await imageFixture(page, 64, 64);
  await page.locator('.image-file').setInputFiles([
    { name: 'before.png', mimeType: 'image/png', buffer: still },
    { name: 'cycle.gif', mimeType: 'image/gif', buffer: colorCycleGifFixture() },
    { name: 'after.png', mimeType: 'image/png', buffer: still },
  ]);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '3');
  await createAndPause(page);
  const report = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const image = dev.spec.finalImages![1]!;
    if (!image.asset.animation) throw new Error('The mixed ending has no animated GIF.');
    const times = [0.1, 0.35, 0.75].map(offset => image.entrance.end + offset);
    const captures = [];
    for (const time of times) captures.push(await dev.capture(time));
    const colors = [];
    for (const capture of captures) {
      const bitmap = new Image(); bitmap.src = capture; await bitmap.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
      colors.push([...context.getImageData(540, 960, 1, 1).data].slice(0, 3));
    }
    const repeated = [];
    for (const time of [times[2]!, 0, times[0]!, dev.spec.duration, times[1]!, times[0]!, times[2]!]) {
      dev.seek(time);
      if (times.includes(time)) repeated.push({ time, capture: await dev.capture(time) });
    }
    const entryTimes = [image.entrance.start + 0.1, image.entrance.end - 0.01];
    const entryColors = [];
    for (const time of entryTimes) {
      const capture = await dev.capture(time);
      const bitmap = new Image(); bitmap.src = capture; await bitmap.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
      entryColors.push([...context.getImageData(540, 960, 1, 1).data]);
    }
    dev.seek(times[1]!);
    return { spec: dev.spec, times, captures, colors, repeated, entryColors };
  });
  expect(report.spec.finalImages!.map(image => image.asset.name)).toEqual(['before.png', 'cycle.gif', 'after.png']);
  const gif = report.spec.finalImages![1]!;
  expect(gif.asset.animation!.frames.map(frame => frame.end)).toEqual([0.2, 0.5, 1]);
  expect(gif.asset.animation!.duration).toBe(1);
  expect(gif.exit.start - gif.entrance.end).toBeGreaterThanOrEqual(1 - 1e-8);
  for (let index = 1; index < report.spec.finalImages!.length; index++) {
    expect(report.spec.finalImages![index]!.entrance.start).toBeCloseTo(report.spec.finalImages![index - 1]!.exit.start, 8);
  }
  expect(new Set(report.captures).size, 'The settled GIF must render three visibly distinct frames').toBe(3);
  expect(report.colors).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  for (const repeated of report.repeated) expect(repeated.capture).toBe(report.captures[report.times.indexOf(repeated.time)]);
  // The tiny early entrance can be subpixel; the fully arrived entrance stays on red.
  expect(report.entryColors[1]!.slice(0, 3)).toEqual([255, 0, 0]);
  const frozen = await page.locator('.stage canvas').screenshot();
  await page.clock.fastForward(1500);
  expect(await page.locator('.stage canvas').screenshot(), 'A paused GIF must not advance on its own wall clock').toEqual(frozen);
  const interfaceScreenshot = testInfo.outputPath('gif-ending.png');
  await page.screenshot({ path: interfaceScreenshot });
  await testInfo.attach('GIF ending interface', { path: interfaceScreenshot, contentType: 'image/png' });
  await page.locator('.replay-button').click();
  await page.clock.fastForward(Math.round(report.times[1]! * 1000));
  await page.locator('.toggle-button').click();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.state().time)).toBeCloseTo(report.times[1]!, 1);
  expect(await page.evaluate(time => (window as unknown as DebugWindow).__CREACTORS_DEV__.capture(time), report.times[1]!)).toBe(report.captures[1]);
  await page.locator('.remix-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'playing');
  await page.locator('.toggle-button').click();
  const remixed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(remixed.seed).not.toBe(report.spec.seed);
  expect(remixed.finalImages!.map(image => image.asset)).toEqual(report.spec.finalImages!.map(image => image.asset));
  await page.locator('button[data-theme="monochrome"]').click();
  const recolored = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(recolored.finalImages).toEqual(remixed.finalImages);
  const recoloredGifPixel = await page.evaluate(async () => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const capture = await dev.capture(dev.spec.finalImages![1]!.entrance.end + 0.35);
    const bitmap = new Image(); bitmap.src = capture; await bitmap.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1920;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0);
    return [...context.getImageData(540, 960, 1, 1).data].slice(0, 3);
  });
  expect(recoloredGifPixel, 'Palette/remix must retain the GIF colors and absolute phase').toEqual([0, 255, 0]);
  await page.locator('.image-remove-button[data-image-index="1"]:visible').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '2');
  const removed = await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.spec);
  expect(removed.finalImages!.map(image => image.asset.name)).toEqual(['before.png', 'after.png']);
  expect(removed.duration).toBeLessThan(remixed.duration);
  expect(removed.objects).toEqual(remixed.objects);
  diagnostics.verify();
});

test('exports animated GIF frames into a decoded MP4 with the same absolute preview timestamps', async ({ page }) => {
  test.setTimeout(90000);
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Go.');
  await createAndPause(page);
  await page.locator('.image-file').setInputFiles([
    { name: 'still.png', mimeType: 'image/png', buffer: await imageFixture(page, 64, 64) },
    { name: 'cycle.gif', mimeType: 'image/gif', buffer: colorCycleGifFixture() },
  ]);
  await expect(page.locator('.studio')).toHaveAttribute('data-image-count', '2');
  await expect(page.locator('.download-button')).toBeEnabled();
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2));
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))])), formats: [media.MP4] });
    const size = dev.renderer.getSize(), previousTime = dev.renderer.lastTime;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The GIF export has no video track.');
      const image = dev.spec.finalImages![1]!;
      const times = [0.1, 0.35, 0.75].map(offset => Math.round((image.entrance.end + offset) * 30) / 30);
      dev.renderer.resize(await track.getDisplayWidth(), await track.getDisplayHeight());
      const reference = document.createElement('canvas'), decoded = document.createElement('canvas');
      reference.width = decoded.width = 144; reference.height = decoded.height = 256;
      const a = reference.getContext('2d', { willReadFrequently: true })!, b = decoded.getContext('2d', { willReadFrequently: true })!;
      const sink = new media.VideoSampleSink(track);
      const frames = [];
      for (const time of times) {
        const sample = await sink.getSample(time + 0.0006);
        if (!sample) throw new Error('An animated GIF export frame is missing.');
        try {
          dev.renderer.renderFrame(time); a.drawImage(dev.renderer.canvas, 0, 0, 144, 256); sample.draw(b, 0, 0, 144, 256);
          const preview = a.getImageData(0, 0, 144, 256).data, video = b.getImageData(0, 0, 144, 256).data;
          let difference = 0;
          for (let index = 0; index < video.length; index += 4) {
            for (let channel = 0; channel < 3; channel++) difference += Math.abs(video[index + channel]! - preview[index + channel]!);
          }
          frames.push({ time, difference: difference / (144 * 256 * 3), color: [...b.getImageData(72, 128, 1, 1).data].slice(0, 3) });
        } finally { sample.close(); }
      }
      return { frames, duration: await input.computeDuration(), expectedDuration: Math.ceil(dev.spec.duration * 30) / 30 };
    } finally { input.dispose(); dev.renderer.resize(...size); dev.renderer.renderFrame(previousTime); }
  }, bytes.toString('base64'));
  expect(report.duration).toBeCloseTo(report.expectedDuration, 3);
  const expectedColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (const [index, frame] of report.frames.entries()) {
    expect(frame.difference).toBeLessThan(3);
    frame.color.forEach((channel, channelIndex) => expect(Math.abs(channel - expectedColors[index]![channelIndex]!)).toBeLessThan(20));
  }
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.getSize())).toEqual([540, 960]);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.lastTime)).toBe(2);
  diagnostics.verify();
});

test('exports ordered final images with matching preview frames and an empty loop seam', async ({ page }) => {
  const diagnostics = await openStudio(page);
  await page.locator('.quote-input').fill('Make it happen.');
  await createAndPause(page);
  const fixture = await imageFixture(page);
  await page.locator('.image-file').setInputFiles([0, 1].map(index => ({ name: `final-${index}.png`, mimeType: 'image/png', buffer: fixture })));
  await expect(page.locator('.studio')).toHaveAttribute('data-has-image', 'true');
  await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.seek(2));
  const downloaded = page.waitForEvent('download');
  await page.locator('.download-button').click();
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'exporting');
  await expect(page.locator('.image-film-button')).toBeDisabled();
  for (const button of await page.locator('.image-remove-button:visible').all()) await expect(button).toBeDisabled();
  const download = await downloaded;
  const bytes = await readFile((await download.path())!);
  const report = await page.evaluate(async encoded => {
    const dev = (window as unknown as DebugWindow).__CREACTORS_DEV__;
    const modulePath = '/node_modules/mediabunny/dist/modules/src/index.js';
    const media = await import(modulePath);
    const input = new media.Input({ source: new media.BlobSource(new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))])), formats: [media.MP4, media.WEBM] });
    const size = dev.renderer.getSize(), time = dev.renderer.lastTime;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The image film has no video track.');
      const holds = dev.spec.finalImages!.map(image => Math.round((image.entrance.end + image.exit.start) / 2 * 30) / 30);
      // Inspect the exported handoff itself, as well as each settled photo.
      const handoffs = dev.spec.finalImages!.slice(0, -1).map(image => Math.round(image.exit.end * 30) / 30);
      const textToPhoto = Math.ceil(Math.max(...dev.spec.objects.map(object => object.exit!.end)) * 30) / 30;
      const points = [0, textToPhoto, ...holds, ...handoffs, (Math.ceil(dev.spec.duration * 30) - 1) / 30].sort((a, b) => a - b);
      const reference = document.createElement('canvas'), decoded = document.createElement('canvas');
      reference.width = decoded.width = 144; reference.height = decoded.height = 256;
      const a = reference.getContext('2d', { willReadFrequently: true })!, b = decoded.getContext('2d', { willReadFrequently: true })!;
      dev.renderer.resize(await track.getDisplayWidth(), await track.getDisplayHeight());
      const sink = new media.VideoSampleSink(track);
      const frames = [];
      for (const timestamp of points) {
        const sample = await sink.getSample(timestamp + 0.0006);
        if (!sample) throw new Error('A requested final-image frame is missing.');
        try {
          dev.renderer.renderFrame(timestamp); a.drawImage(dev.renderer.canvas, 0, 0, 144, 256); sample.draw(b, 0, 0, 144, 256);
          const preview = a.getImageData(0, 0, 144, 256).data, video = b.getImageData(0, 0, 144, 256).data;
          let difference = 0, greenPixels = 0;
          for (let index = 0; index < preview.length; index += 4) {
            difference += Math.abs(preview[index]! - video[index]!) + Math.abs(preview[index + 1]! - video[index + 1]!) + Math.abs(preview[index + 2]! - video[index + 2]!);
            if (video[index]! < 55 && video[index + 1]! > 200 && video[index + 2]! < 55) greenPixels++;
          }
          frames.push({ time: timestamp, meanDifference: difference / (144 * 256 * 3), greenPixels, pixels: [...video], previewPixels: [...preview] });
        } finally { sample.close(); }
      }
      const first = frames[0]!.pixels, last = frames.at(-1)!.pixels;
      const previewFirst = frames[0]!.previewPixels, previewLast = frames.at(-1)!.previewPixels;
      let loopDifference = 0, previewLoopDifference = 0;
      for (let index = 0; index < first.length; index += 4) {
        loopDifference += Math.abs(first[index]! - last[index]!) + Math.abs(first[index + 1]! - last[index + 1]!) + Math.abs(first[index + 2]! - last[index + 2]!);
        previewLoopDifference += Math.abs(previewFirst[index]! - previewLast[index]!) + Math.abs(previewFirst[index + 1]! - previewLast[index + 1]!) + Math.abs(previewFirst[index + 2]! - previewLast[index + 2]!);
      }
      return { duration: await input.computeDuration(), expectedDuration: Math.ceil(dev.spec.duration * 30) / 30,
        frames: frames.map(({ pixels: _pixels, previewPixels: _previewPixels, ...frame }) => frame), previewLoopDifference, loopDifference: loopDifference / (144 * 256 * 3) };
    } finally { input.dispose(); dev.renderer.resize(...size); dev.renderer.renderFrame(time); }
  }, bytes.toString('base64'));
  expect(report.duration).toBeCloseTo(report.expectedDuration, 3);
  for (const frame of report.frames) expect(frame.meanDifference).toBeLessThan(3);
  expect(report.frames[0]!.greenPixels).toBe(0);
  for (const frame of report.frames.slice(1, -1)) expect(frame.greenPixels).toBeGreaterThan(100);
  expect(report.frames.at(-1)!.greenPixels).toBe(0);
  expect(report.previewLoopDifference, 'The rendered loop must have an exactly identical empty background').toBe(0);
  // Native lossy codecs can round the same RGB background differently in an
  // initial keyframe and a final predicted frame. Use the reference tolerance.
  expect(report.loopDifference).toBeLessThan(3);
  await expect(page.locator('.studio')).toHaveAttribute('data-state', 'paused');
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.getSize())).toEqual([540, 960]);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).__CREACTORS_DEV__.renderer.lastTime)).toBe(2);
  diagnostics.verify();
});
