import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const directory = resolve(fileURLToPath(new URL('../dist-static/', import.meta.url)));
await readFile(resolve(directory, 'index.html'));
const base = '/studio/'; // Exercise deployment under a path, not just origin root.
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let simulateUpdate = false;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404); response.end(); return; }
    const file = resolve(directory, pathname.slice(base.length) || 'index.html');
    if (!file.startsWith(directory + sep)) { response.writeHead(403); response.end(); return; }
    let content = await readFile(file);
    if (simulateUpdate && pathname === base + 'sw.js') {
      content = Buffer.from(content.toString().replace(/const CACHE_NAME = CACHE_PREFIX \+ '([^']+)';/, "const CACHE_NAME = CACHE_PREFIX + '$1-update-check';"));
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const url = origin + base;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const external = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    const requestUrl = new URL(request.url());
    if (/^https?:$/.test(requestUrl.protocol) && requestUrl.origin !== origin) external.push(request.url());
  });
  const online = await context.newPage();
  await online.goto(url);
  await online.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return !!registration?.active;
  });
  const installed = await online.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const manifestUrl = document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await fetch(manifestUrl)).json();
    return { scope: registration.scope, caches: await caches.keys(), manifest };
  });
  if (installed.scope !== url) throw new Error(`Incorrect nested service-worker scope: ${installed.scope}`);
  if (!installed.caches.some(name => name.startsWith('creactors-shell-'))) throw new Error('Application shell was not cached.');
  if (installed.manifest.start_url !== './' || installed.manifest.scope !== './') throw new Error('The manifest must remain relative to its deployment directory.');
  for (const icon of installed.manifest.icons) {
    if (!icon.purpose.includes('maskable') || !icon.sizes.match(/^(192x192|512x512)$/)) throw new Error('Missing installable maskable PNG icons.');
  }
  await online.close();
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(url);
  await offline.waitForSelector('.stage canvas');
  await offline.locator('.help-button').click();
  if (!await offline.locator('.help-dialog').evaluate(dialog => dialog.open)) throw new Error('Offline help did not open.');
  if (await offline.locator('.help-feature').count() !== 7) throw new Error('The offline help overview is incomplete.');
  await offline.keyboard.press('Escape');
  if (await offline.locator('.help-dialog').evaluate(dialog => dialog.open)) throw new Error('Offline help did not close.');
  const controlled = await offline.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) throw new Error('The reopened offline page is not controlled by its service worker.');
  const quote = offline.locator('.quote-input');
  const firstExample = await quote.inputValue();
  if (!firstExample.trim()) throw new Error('A random example was not preloaded offline.');
  await offline.waitForFunction(() => document.querySelector('canvas')?.dataset.seed !== undefined);
  if (await offline.locator('#film-transcript').textContent() !== firstExample) throw new Error('The offline welcome does not use its initial example.');
  const initialProgress = await offline.locator('.progress-track').inputValue();
  await offline.waitForFunction(previous => document.querySelector('.progress-track')?.value !== previous, initialProgress);
  if (await offline.locator('.studio').getAttribute('data-state') !== 'idle'
    || await offline.locator('.studio').getAttribute('data-has-film') !== 'false'
    || !await offline.locator('.create-button').isVisible()) throw new Error('The animated welcome hid the offline editor.');
  await offline.locator('.example-button').click();
  if (await quote.inputValue() === firstExample) throw new Error('The offline example button repeated its phrase.');
  await offline.locator('.font-editor-button').click();
  await offline.locator('[data-font-id="montserrat-bold"]').click();
  await offline.locator('#font-picker').waitFor({ state: 'hidden' });
  if (!(await quote.evaluate(element => element.style.fontFamily)).includes('Montserrat')) throw new Error('The offline draft did not load its selected font.');
  await offline.locator('.create-button').click();
  await offline.waitForFunction(() => ['playing', 'paused'].includes(document.querySelector('.studio')?.dataset.state), undefined, { timeout: 60_000 });
  if ((await offline.locator('.studio').getAttribute('data-state')) === 'playing') await offline.locator('.toggle-button').click();
  for (const [fontId, name] of [
    ['bungee', 'Bungee'], ['black-ops-one', 'Black Ops One'], ['alfa-slab-one', 'Alfa Slab One'],
    ['press-start-2p', 'Pixel Arcade'], ['barlow-condensed-black', 'Barlow Condensed Black'],
    ['bebas-neue', 'Bebas Neue'], ['montserrat-bold', 'Montserrat Bold'], ['anton', 'Anton'],
  ]) {
    await offline.locator('.font-film-button').click();
    await offline.locator(`[data-font-id="${fontId}"]`).click();
    await offline.locator('#font-picker').waitFor({ state: 'hidden' });
    if (!(await offline.locator('.font-film-button').getAttribute('aria-label')).includes(name)) throw new Error(`The offline film did not load ${name}.`);
  }
  for (const colorScheme of ['dark', 'light']) {
    await offline.emulateMedia({ colorScheme });
    await offline.waitForFunction(scheme => document.documentElement.dataset.colorScheme === scheme, colorScheme);
    const theme = await offline.locator('.studio').getAttribute('data-theme');
    if (theme.endsWith('-light') !== (colorScheme === 'light')) throw new Error('The offline film did not follow OS appearance.');
  }
  await offline.locator('.audio-button').click();
  for (const id of ['oh-no', 'synthwave-house', 'phonk-time', 'sneaky-snitch', 'monkeys-spinning-monkeys', 'meme-de-creditos-finales']) {
    await offline.locator(`[data-audio-preset="${id}"]`).click();
    await offline.waitForFunction(selected => document.querySelector('.studio')?.dataset.hasAudio === 'true'
      && document.querySelector(`[data-audio-preset="${selected}"]`)?.getAttribute('aria-pressed') === 'true', id);
  }
  if (await offline.locator('.studio').getAttribute('data-has-audio') !== 'true') throw new Error('The offline soundtrack did not prepare.');
  await offline.locator('.audio-credits-button').click();
  if (!await offline.locator('.audio-credits-dialog').evaluate(dialog => dialog.open)) throw new Error('Offline audio credits did not open.');
  if (!(await offline.locator('.audio-credits-dialog').textContent()).includes('Générique de fin')) throw new Error('The new recording is missing from offline audio credits.');
  await offline.keyboard.press('Escape');
  if (await offline.locator('.audio-credits-dialog').evaluate(dialog => dialog.open)) throw new Error('Offline audio credits did not close.');
  await offline.locator('.audio-button').click();
  const imageBytes = Buffer.from(await offline.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext('2d'); context.fillStyle = '#00ff00'; context.fillRect(0, 0, 120, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const gifBytes = await readFile(new URL('../tests/fixtures/colors.gif', import.meta.url));
  await offline.locator('.image-file').setInputFiles([
    ...[0, 1].map(index => ({ name: `offline-photo-${index}.png`, mimeType: 'image/png', buffer: imageBytes })),
    { name: 'offline-cycle.gif', mimeType: 'image/gif', buffer: gifBytes },
  ]);
  await offline.waitForFunction(() => document.querySelector('.studio')?.dataset.imageCount === '3' && document.querySelector('.studio')?.dataset.state === 'paused');
  if (await offline.locator('.studio').getAttribute('data-has-image') !== 'true') throw new Error('Offline local image import failed.');
  if (await offline.locator('.image-film-source .image-item').count() !== 3) throw new Error('Offline image order/gallery did not prepare.');
  if (await offline.locator('.image-film-source .image-gif-badge').count() !== 1) throw new Error('Offline GIF animation did not prepare.');
  await offline.locator('.toggle-button').click();
  await offline.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'playing');
  await offline.locator('.toggle-button').click();
  await mkdir(new URL('../artifacts/review/', import.meta.url), { recursive: true });
  await offline.screenshot({ path: fileURLToPath(new URL('../artifacts/review/offline-static.png', import.meta.url)) });

  // Updating the generated worker must not replace a page that is already
  // playing or exporting. A new cache is installed, then waits for closure.
  await context.setOffline(false);
  await offline.evaluate(() => {
    window.__offlineControllerChanges = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => window.__offlineControllerChanges++);
  });
  simulateUpdate = true;
  await offline.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await offline.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');
  const pending = await offline.evaluate(async () => ({
    changes: window.__offlineControllerChanges,
    state: document.querySelector('.studio')?.dataset.state,
    caches: (await caches.keys()).filter(name => name.startsWith('creactors-shell-')),
  }));
  if (pending.changes !== 0 || pending.state !== 'paused' || pending.caches.length !== 2) throw new Error('An update interrupted the active session instead of waiting.');
  await context.setOffline(true);
  await offline.close();
  const updated = await context.newPage();
  await updated.goto(url);
  await updated.waitForFunction(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('creactors-shell-'));
    return names.length === 1 && names[0].endsWith('-update-check');
  });
  await updated.waitForSelector('.stage canvas');
  if (errors.length) throw new Error(`Offline runtime errors: ${errors.join('; ')}`);
  if (external.length) throw new Error(`External runtime requests: ${external.join('; ')}`);
  const size = (await readFile(resolve(directory, 'index.html'))).byteLength;
  console.log(`Offline reopening passed at ${base}: animated example welcome, help dialog, eight display fonts, portrait playback, six recorded soundtracks and audio credits, local photo/GIF import, safe waiting/activation of updates, ${installed.manifest.icons.length} maskable icons, ${(size / 1024 / 1024).toFixed(2)} MiB self-contained page, no external requests or runtime errors.`);
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
