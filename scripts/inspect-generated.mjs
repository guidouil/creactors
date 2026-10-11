import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const corpus = [
  "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.",
  "L'intelligence artificielle ne remplace pas les créateurs. Elle en crée de nouveaux.",
  'Et si tout commençait maintenant ?', "On ne voit bien qu'avec le cœur.",
  "L'imagination est plus importante que le savoir.",
  'The future is not what awaits us. It is what we create.',
  "AI doesn't replace creators. It creates more of them.",
  'What if everything started now?', 'Less noise. More meaning.', 'Make your words impossible to ignore.',
  'Créons 👨‍👩‍👧‍👦 👍🏽 🇫🇷 1️⃣ maintenant.',
];
await mkdir('artifacts/generated', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.argv[2] || 'http://127.0.0.1:5174/');
  await page.evaluate(() => window.__CREACTORS_DEV__.ready);
  const reports = [];
  const seeds = Number(process.argv[3] || 20);
  for (let quote = 0; quote < corpus.length; quote++) {
    for (let seed = 1; seed <= seeds; seed++) {
      const result = await page.evaluate(async ({ text, seed }) => {
        const api = window.__CREACTORS_DEV__;
        await api.generate(text, seed);
        const spec = api.spec;
        const badBounds = [];
        const projected = [];
        for (const object of spec.objects) {
          api.seek((object.readingInterval[0] + object.readingInterval[1]) / 2);
          const box = api.bounds().find(box => box.id === object.id);
          projected.push({ id: object.id, min: box.min, max: box.max });
          if (box.min[0] < -0.85 || box.max[0] > 0.85 || box.min[1] < -0.65 || box.max[1] > 0.76 || box.min[2] < -1 || box.max[2] > 1) badBounds.push(box);
        }
        const framePixels = time => {
          api.seek(time);
          const gl = api.renderer.renderer.getContext();
          const [w, h] = api.renderer.getSize();
          const pixels = new Uint8Array(w * h * 4);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const bg = pixels.slice(0, 3);
          let nonBackground = 0;
          for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - bg[0]) + Math.abs(pixels[i + 1] - bg[1]) + Math.abs(pixels[i + 2] - bg[2]) > 12) nonBackground++;
          return nonBackground;
        };
        const initialPixels = framePixels(0);
        const finalPixels = framePixels(spec.duration - 1 / 30);
        return { text, seed, duration: spec.duration, primitives: spec.cameraTracks.map(track => track.primitive), groups: spec.objects.map(object => object.displayText), badBounds, projected, initialPixels, finalPixels };
      }, { text: corpus[quote], seed });
      reports.push(result);
      if (seed <= 2) {
        const spec = await page.evaluate(() => window.__CREACTORS_DEV__.spec);
        const times = spec.objects.map(object => (object.readingInterval[0] + object.readingInterval[1]) / 2).concat(spec.posterTime);
        for (let index = 0; index < times.length; index++) {
          const data = await page.evaluate(time => window.__CREACTORS_DEV__.capture(time), times[index]);
          await writeFile(`artifacts/generated/q${quote + 1}-s${seed}-f${index}.png`, Buffer.from(data.split(',')[1], 'base64'));
        }
      }
    }
    console.log(`Reviewed quote ${quote + 1}/${corpus.length}, ${seeds} seeds.`);
  }
  await writeFile('artifacts/generated/report.json', JSON.stringify({ reports, errors }, null, 2));
  const failures = reports.filter(report => report.badBounds.length || report.initialPixels || report.finalPixels);
  console.log(JSON.stringify({ scenes: reports.length, errors, failures: failures.map(({ text, seed, badBounds, initialPixels, finalPixels }) => ({ text, seed, badBounds, initialPixels, finalPixels })) }, null, 2));
  if (failures.length || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
