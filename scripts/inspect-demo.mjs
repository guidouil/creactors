import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../artifacts/review/', import.meta.url);
const previewUrl = process.argv[2] || process.env.CREACTORS_PREVIEW_URL || 'http://127.0.0.1:5173';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(previewUrl);
  await page.waitForFunction(() => window.__CREACTORS_DEV__?.ready);
  await page.evaluate(() => window.__CREACTORS_DEV__.ready);
  const ending = await page.evaluate(async () => {
    const dev = window.__CREACTORS_DEV__;
    await dev.generate("Le futur n'est pas ce qui nous attend. C'est ce que nous créons.");
    dev.seek(dev.spec.posterTime);
    return {
      poster: dev.spec.posterTime, duration: dev.spec.duration,
      reveal: dev.spec.cameraTracks.find(track => track.id === 'reveal-world'),
      rush: dev.spec.cameraTracks.find(track => track.id === 'rush-to-screen'),
    };
  });
  await page.screenshot({ path: new URL('desktop.png', directory).pathname });
  const frames = [];
  const times = [0, 0.3, 1.4, 2.7, 4.2, 4.6, 4.8, 5, 5.15, 5.3, 5.45, 5.7, 7.6,
    ending.reveal.start, (ending.reveal.start + ending.reveal.end) / 2, ending.poster,
    (ending.rush.start + ending.rush.end) / 2, ending.rush.end, ending.duration];
  for (const time of times) {
    const data = await page.evaluate(time => window.__CREACTORS_DEV__.capture(time), time);
    const filename = `frame-${String(time).replace('.', '-')}.png`;
    await writeFile(new URL(filename, directory), Buffer.from(data.split(',')[1], 'base64'));
    frames.push(await page.evaluate(() => ({ time: window.__CREACTORS_DEV__.state().time, bounds: window.__CREACTORS_DEV__.bounds(), metrics: window.__CREACTORS_DEV__.metrics() })));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(time => window.__CREACTORS_DEV__.seek(time), ending.poster);
  await page.screenshot({ path: new URL('mobile.png', directory).pathname });
  await writeFile(new URL('measurements.json', directory), JSON.stringify({ errors, frames }, null, 2));
  console.log(JSON.stringify({ errors, captures: frames.length, directory: directory.pathname }));
} finally { await browser.close(); }
