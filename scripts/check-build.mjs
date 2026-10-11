import { readFile, writeFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const notices = await Promise.all([
  ['Three.js', 'node_modules/three/LICENSE'],
  ['Troika', 'node_modules/troika-three-text/LICENSE'],
  ['Troika Three Utils', 'node_modules/troika-three-utils/LICENSE'],
  ['Troika Worker Utils', 'node_modules/troika-worker-utils/LICENSE'],
  ['WebGL SDF Generator', 'node_modules/webgl-sdf-generator/LICENSE.txt'],
  ['Bidi.js', 'node_modules/bidi-js/LICENSE.txt'],
  ['Barlow Condensed Black', 'assets/licenses/BarlowCondensed-OFL.txt'],
  ['Anton', 'assets/licenses/Anton-OFL.txt'],
  ['Bebas Neue', 'assets/licenses/BebasNeue-OFL.txt'],
  ['Montserrat Bold', 'assets/licenses/Montserrat-OFL.txt'],
  ['OpenType.js', 'node_modules/opentype.js/LICENSE'],
  ['Noto Emoji', 'assets/licenses/NotoEmoji-OFL.txt'],
  ['Unicode emoji sequence data', 'assets/licenses/Unicode-LICENSE.txt'],
  ['franc', 'assets/licenses/franc-MIT.txt'],
  ['Trigram Utils', 'node_modules/trigram-utils/license'],
  ['N-Gram', 'node_modules/n-gram/license'],
  ['Collapse White Space', 'node_modules/collapse-white-space/license'],
  ['Gifuct.js', 'node_modules/gifuct-js/LICENSE'],
  ['JS Binary Schema Parser', 'node_modules/js-binary-schema-parser/LICENSE'],
  ['GIPHY JS Fetch API 5.8.0, JS Util 5.2.0 and JS Types 5.1.0 — source https://github.com/Giphy/giphy-js', 'assets/licenses/GIPHY-MIT.txt'],
  ['UUID 9.0.1', 'node_modules/uuid/LICENSE.md'],
  ['Bundled audio recordings and attribution', 'assets/audio/credits.txt'],
  ['Mediabunny 1.61.3 — source https://github.com/Vanilagy/mediabunny/tree/v1.61.3', 'node_modules/mediabunny/LICENSE'],
].map(async ([name, file]) => `${name}\n${await readFile(file, 'utf8')}`));
const file = new URL('../dist/index.html', import.meta.url);
let html = await readFile(file, 'utf8');
html = html.replace('</body>', `<!-- Bundled license notices\n${notices.join('\n\n').replace(/-->/g, '-- >')}\n--></body>`);
await writeFile(file, html);
if (/<script[^>]+src=|<link[^>]+rel="stylesheet"/i.test(html)) throw new Error('External script or stylesheet in portable build.');
if (html.includes('__CREACTORS_DEV__') || html.includes('CREACTORS / INSPECT')) throw new Error('Development tools leaked into production.');
const files = await readdir(new URL('../dist/', import.meta.url));
if (files.length !== 1 || files[0] !== 'index.html') throw new Error('Expected exactly one production HTML file.');
const audioDirectory = new URL('../assets/audio/', import.meta.url);
const audioFiles = (await readdir(audioDirectory)).filter(name => /\.(mp3|m4a)$/i.test(name));
await Promise.all(audioFiles.map(async name => {
  const bytes = await readFile(new URL(name, audioDirectory));
  if (!html.includes(bytes.toString('base64'))) throw new Error(`Audio recording is missing from the portable HTML: ${name}`);
}));
console.log(`Portable HTML: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB; gzip ${(gzipSync(html).byteLength / 1024).toFixed(0)} KiB. ${audioFiles.length} audio files embedded byte-for-byte. No external assets or development tools.`);
