import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const portableDirectory = new URL('../dist/', import.meta.url);
const destination = new URL('../dist-static/', import.meta.url);
const files = await readdir(portableDirectory);
if (files.length !== 1 || files[0] !== 'index.html') throw new Error('Build the portable HTML before the static application.');
const portableHtml = await readFile(new URL('index.html', portableDirectory), 'utf8');
const scriptSource = await readFile(new URL(import.meta.url), 'utf8');
const revision = createHash('sha256').update(portableHtml).update(scriptSource).digest('hex').slice(0, 16);

// This is a second distribution. The portable artifact is never changed.
await rm(destination, { recursive: true, force: true });
await mkdir(new URL('icons/', destination), { recursive: true });
const registration = `<script>
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).catch(function (error) {
      console.info('CREACTORS offline installation is unavailable.', error);
    });
  }, { once: true });
}
</script>`;
const staticHtml = portableHtml
  .replace('</head>', '<link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"></head>')
  .replace('</body>', `${registration}</body>`);
await writeFile(new URL('index.html', destination), staticHtml);

const manifest = {
  id: './',
  name: 'CREACTORS',
  short_name: 'CREACTORS',
  description: 'Make words move.',
  lang: 'en',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#111126',
  theme_color: '#111126',
  icons: [192, 512].map(size => ({ src: `./icons/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
};
await writeFile(new URL('manifest.webmanifest', destination), `${JSON.stringify(manifest, null, 2)}\n`);

const sw = `/* CREACTORS: generated offline shell ${revision}. */
'use strict';
const CACHE_PREFIX = 'creactors-shell-';
const CACHE_NAME = CACHE_PREFIX + '${revision}';
const ROOT = self.registration.scope;
const INDEX = new URL('index.html', ROOT).href;
const ASSETS = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'].map(path => new URL(path, ROOT).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
  })());
  // No skipWaiting: a new build waits until active playback/export sessions close.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
  })());
  // No clients.claim: installing the app never reloads an existing session.
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(INDEX) || await fetch(request);
    })());
    return;
  }
  if (!ASSETS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request) || await fetch(request);
  })());
});
`;
await writeFile(new URL('sw.js', destination), sw);

// Four samples per pixel keep the brand's circle edge sharp without a raster
// dependency. The opaque, centered mark also fits maskable icon safe areas.
function png(size) {
  const background = [17, 17, 38, 255];
  const pink = [245, 139, 180, 255];
  const coral = [255, 181, 138, 255];
  const radius = size * 0.265;
  const center = size / 2;
  const gap = size * 0.018;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0, 0];
      for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
        const inside = Math.hypot(x + dx - center, y + dy - center) <= radius;
        const sample = !inside || Math.abs(y + dy - center) < gap / 2 ? background : y + dy < center ? pink : coral;
        for (let channel = 0; channel < 4; channel++) color[channel] += sample[channel] / 4;
      }
      for (let channel = 0; channel < 4; channel++) pixels[row + 1 + x * 4 + channel] = Math.round(color[channel]);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const bytes = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}
for (const size of [192, 512]) await writeFile(new URL(`icons/icon-${size}.png`, destination), png(size));
await writeFile(new URL('icons/apple-touch-icon.png', destination), png(180));
console.log(`Static offline app: dist-static/; revision ${revision}. Publish over HTTPS (localhost works for local checks). Updates wait for active sessions to close.`);
