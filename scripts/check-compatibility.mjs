import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { firefox, webkit } from 'playwright';

const url = process.argv[2] || process.env.CREACTORS_PREVIEW_URL || 'http://127.0.0.1:5173/';
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), 'Library', 'Caches', 'ms-playwright');
const directory = new URL('../artifacts/compatibility/', import.meta.url);
await mkdir(directory, { recursive: true });
const targets = [
  { name: 'firefox', launcher: firefox, executablePath: join(cache, 'firefox-1532', 'firefox', 'Nightly.app', 'Contents', 'MacOS', 'firefox') },
  { name: 'webkit', launcher: webkit, executablePath: join(cache, 'webkit-2311', 'pw_run.sh') },
];

async function inspect(target) {
  let browser;
  const result = { browser: target.name, executablePath: target.executablePath, errors: [], externalRequests: [] };
  const step = async (name, operation, timeout = 30000) => {
    result.phase = name;
    console.log(JSON.stringify({ browser: target.name, phase: name, version: result.version }));
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} did not finish within ${timeout / 1000}s.`)), timeout);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    await access(target.executablePath);
    browser = await step('launch', target.launcher.launch({ headless: true, executablePath: target.executablePath, timeout: 20000 }));
    result.version = browser.version();
    const page = await step('create page', browser.newPage({ viewport: { width: 1280, height: 900 } }));
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('request', request => {
      const requested = new URL(request.url());
      if (/^https?:$/.test(requested.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(requested.hostname)) result.externalRequests.push(request.url());
    });
    await step('open', page.goto(url));
    result.capabilities = await step('capabilities', page.evaluate(() => ({
      secureContext: isSecureContext,
      videoEncoder: typeof VideoEncoder !== 'undefined',
      videoFrame: typeof VideoFrame !== 'undefined',
      webgl2: Boolean(document.querySelector('.stage canvas').getContext('webgl2')),
    })));
    await page.waitForFunction(() => Boolean(window.__CREACTORS_DEV__?.ready));
    await step('prepare initial film', page.evaluate(async () => { await window.__CREACTORS_DEV__.ready; }));
    await page.locator('[data-locale="en"]').click();
    const quotation = 'Less noise. More meaning. Create together 💡 👨‍👩‍👧‍👦.';
    result.generated = await step('generate emoji quotation', page.evaluate(async quotation => {
      const dev = window.__CREACTORS_DEV__;
      await dev.generate(quotation, 2026, 'en');
      const frame = await dev.capture(dev.spec.posterTime);
      const blank = await dev.capture(dev.spec.duration);
      const gl = dev.renderer.renderer.getContext();
      return {
        sourceText: dev.spec.sourceText, seed: dev.spec.seed, duration: dev.spec.duration,
        objectCount: dev.spec.objects.length, nonblankPoster: frame !== blank,
        glVersion: gl.getParameter(gl.VERSION), renderer: gl.getParameter(gl.RENDERER),
        cameraTracks: dev.spec.cameraTracks,
      };
    }, quotation));
    assert.equal(result.generated.sourceText, quotation);
    assert.equal(result.generated.nonblankPoster, true);
    await step('remix', page.locator('.remix-button').click());
    await page.waitForFunction(() => document.querySelector('.studio').dataset.state === 'playing');
    await page.locator('.toggle-button').click();
    const remixed = await page.evaluate(() => ({ seed: window.__CREACTORS_DEV__.spec.seed, cameraTracks: window.__CREACTORS_DEV__.spec.cameraTracks }));
    assert.notEqual(remixed.seed, result.generated.seed);
    assert.notDeepEqual(remixed.cameraTracks, result.generated.cameraTracks);
    result.remix = 'passed';
    delete result.generated.cameraTracks;
    await step('capture preview', page.screenshot({ path: new URL(`${target.name}-preview.png`, directory).pathname }));
    const exportDuration = await step('prepare authored export', page.evaluate(async () => {
      await window.__CREACTORS_DEV__.generate("Le futur n'est pas ce qui nous attend. C'est ce que nous créons.");
      window.__CREACTORS_DEV__.seek(2.7);
      return window.__CREACTORS_DEV__.spec.duration;
    }));
    let downloaded;
    page.on('download', download => { downloaded = download; });
    const initiallyDisabled = await page.locator('.download-button').isDisabled();
    if (initiallyDisabled) {
      result.export = { status: 'unavailable', honestDisabledState: true, label: await page.locator('.download-button').getAttribute('aria-label') };
    } else {
      for (let attempt = 0; attempt < 2 && !downloaded; attempt++) {
        await page.locator('.download-button').click();
        await page.waitForFunction(() => document.querySelector('.studio').dataset.state !== 'exporting', null, { timeout: 65000 });
        await page.waitForTimeout(150);
        if (downloaded || await page.locator('.download-button').isDisabled()) break;
        const message = await page.locator('.message').textContent();
        if (!message?.includes('720p')) break;
      }
      if (downloaded) {
        const file = new URL(`${target.name}-${downloaded.suggestedFilename()}`, directory).pathname;
        await downloaded.saveAs(file);
        const bytes = await readFile(file);
        const format = downloaded.suggestedFilename().endsWith('.mp4') ? 'mp4' : 'webm';
        if (format === 'mp4') assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp');
        else assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
        const metadata = await page.evaluate(async data => {
          const { Input, BlobSource, MP4, WEBM, EncodedPacketSink } = await import('/node_modules/mediabunny/dist/modules/src/index.js');
          const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
          const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [MP4, WEBM] });
          try {
            const track = await input.getPrimaryVideoTrack();
            if (!track) throw new Error('No encoded video track.');
            let frames = 0;
            for await (const packet of new EncodedPacketSink(track).packets()) frames++;
            return { codec: await track.getCodec(), width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), duration: await input.computeDuration(), frames };
          } finally { input.dispose(); }
        }, bytes.toString('base64'));
        assert.equal(metadata.width / metadata.height, 9 / 16);
        const expectedFrames = Math.ceil(exportDuration * 30);
        assert.ok(Math.abs(metadata.duration - expectedFrames / 30) < 0.001);
        assert.equal(metadata.frames, expectedFrames);
        result.export = { status: 'passed', format, bytes: bytes.length, file, ...metadata };
        const preview = await page.evaluate(() => ({ size: window.__CREACTORS_DEV__.renderer.getSize(), time: window.__CREACTORS_DEV__.renderer.lastTime }));
        assert.deepEqual(preview, { size: [540, 960], time: 2.7 });
      } else {
        const disabled = await page.locator('.download-button').isDisabled();
        const message = await page.locator('.message').textContent();
        result.export = { status: 'unavailable', honestDisabledState: disabled, message };
        assert.equal(disabled, true, 'A browser without native codecs must expose a disabled unavailable state.');
      }
    }
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.externalRequests, []);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.stack || String(error);
  } finally {
    if (browser) {
      let timeout;
      try { await Promise.race([browser.close(), new Promise(resolve => { timeout = setTimeout(resolve, 5000); })]); }
      finally { clearTimeout(timeout); }
    }
  }
  console.log(JSON.stringify(result));
  return result;
}

// The browser engines are independent and use separate contexts/resources.
const results = await Promise.all(targets.map(inspect));
await writeFile(new URL('results.json', directory), JSON.stringify(results, null, 2));
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
