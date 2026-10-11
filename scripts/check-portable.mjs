import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Input, BlobSource, MP4, WEBM } from 'mediabunny';

const file = new URL('../dist/index.html', import.meta.url);
const liveGiphy = process.env.CREACTORS_GIPHY_LIVE === '1';
const directory = new URL('../artifacts/review/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  const requests = [];
  let giphyRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (liveGiphy && (url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com'))) {
      giphyRequests++;
      return route.continue();
    }
    requests.push(route.request().url());
    return route.abort('internetdisconnected');
  });
  await page.goto(file.href);
  await page.locator('.help-button').click();
  assert.equal(await page.locator('.help-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('.help-feature').count(), 7);
  assert.ok((await page.locator('.help-dialog').textContent()).includes('MP4'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.help-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('.help-button').evaluate(button => button === document.activeElement), true);
  const initialExample = await page.locator('.quote-input').inputValue();
  assert.ok(initialExample.trim(), 'A random example must be preloaded offline.');
  await page.waitForFunction(() => document.querySelector('canvas')?.dataset.seed !== undefined);
  assert.equal(await page.locator('#film-transcript').textContent(), initialExample, 'The welcome must use its current example.');
  const initialProgress = await page.locator('.progress-track').inputValue();
  await page.waitForFunction(previous => document.querySelector('.progress-track')?.value !== previous, initialProgress);
  assert.equal(await page.locator('.studio').getAttribute('data-state'), 'idle');
  assert.equal(await page.locator('.studio').getAttribute('data-has-film'), 'false');
  assert.equal(await page.locator('.studio').getAttribute('data-editing'), 'true');
  assert.equal(await page.locator('.create-button').isVisible(), true, 'Welcome motion must leave the editor available.');
  await page.locator('.example-button').click();
  assert.notEqual(await page.locator('.quote-input').inputValue(), initialExample);
  await page.locator('.font-editor-button').click();
  assert.equal(await page.locator('.font-device-button').isVisible(), false, 'An opaque file origin cannot enumerate device fonts.');
  await page.locator('[data-font-id="montserrat-bold"]').click();
  await page.locator('#font-picker').waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.quote-input').evaluate(element => element.style.fontFamily)).includes('Montserrat'));
  await page.locator('.create-button').click();
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'playing', null, { timeout: 30000 });
  await page.waitForTimeout(1100);
  await page.locator('.toggle-button').click();
  assert.equal(await page.locator('.studio').getAttribute('data-state'), 'paused');
  const state = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const frame = document.querySelector('.stage').getBoundingClientRect();
    return { width: canvas.width, height: canvas.height, aspect: frame.width / frame.height, devTools: '__CREACTORS_DEV__' in window };
  });
  assert.equal(state.devTools, false, 'Production must exclude the development API.');
  assert.equal(state.width / state.height, 9 / 16);
  assert.ok(Math.abs(state.aspect - 9 / 16) < 0.002);
  await page.locator('.font-film-button').click();
  await page.locator('.font-file').setInputFiles(new URL('../assets/fonts/Anton-Regular.ttf', import.meta.url).pathname);
  await page.locator('#font-picker').waitFor({ state: 'hidden' });
  assert.ok((await page.locator('.font-film-button').getAttribute('aria-label')).includes('Anton'), 'Static font import must work from a portable file.');
  const quote = 'Créons ensemble 👨‍👩‍👧‍👦 1️⃣ ❤️. Le futur est ici.';
  await page.locator('.quote-input').fill(quote);
  await page.locator('.create-button').click();
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'playing');
  await page.locator('.toggle-button').click();
  assert.equal(await page.locator('#film-transcript').textContent(), quote);
  assert.equal(await page.locator('#film-transcript').getAttribute('lang'), 'fr');
  assert.equal(await page.locator('[data-input-language]').count(), 0);
  await page.locator('.progress-track').press('Home');
  assert.equal(Number(await page.locator('.progress-track').inputValue()), 0);
  await page.locator('.progress-track').press('ArrowRight');
  assert.equal(Number(await page.locator('.progress-track').inputValue()), 1);
  assert.equal(await page.locator('.studio').getAttribute('data-state'), 'paused');
  const firstSeed = await page.locator('canvas').getAttribute('data-seed');
  await page.locator('.remix-button').click();
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'playing');
  await page.locator('.toggle-button').click();
  assert.notEqual(await page.locator('canvas').getAttribute('data-seed'), firstSeed);
  await page.locator('button[data-theme="monochrome"]').click();
  assert.equal(await page.locator('button[data-theme="monochrome"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.studio').getAttribute('data-theme'), 'monochrome-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.theme === 'monochrome');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.theme === 'monochrome-light');
  await page.locator('.audio-button').click();
  const audioIds = ['oh-no', 'synthwave-house', 'phonk-time', 'sneaky-snitch', 'monkeys-spinning-monkeys', 'meme-de-creditos-finales'];
  assert.equal(await page.locator('[data-audio-preset]').count(), audioIds.length);
  for (const id of audioIds) {
    await page.locator(`[data-audio-preset="${id}"]`).click();
    await page.waitForFunction(selected => document.querySelector('.studio')?.dataset.hasAudio === 'true'
      && document.querySelector(`[data-audio-preset="${selected}"]`)?.getAttribute('aria-pressed') === 'true', id);
  }
  assert.equal(await page.locator('.studio').getAttribute('data-has-audio'), 'true');
  await page.locator('.audio-credits-button').click();
  assert.equal(await page.locator('.audio-credits-dialog').evaluate(dialog => dialog.open), true);
  assert.ok((await page.locator('.audio-credits-dialog').textContent()).includes('Kevin MacLeod'));
  assert.ok((await page.locator('.audio-credits-dialog').textContent()).includes('Générique de fin'));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.audio-credits-dialog').evaluate(dialog => dialog.open), false);
  await page.locator('.audio-button').click();
  const imageBytes = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext('2d');
    context.fillStyle = '#00ff00'; context.fillRect(0, 0, 120, 80);
    context.fillStyle = '#ff0000'; context.fillRect(60, 0, 60, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const gifBytes = await readFile(new URL('../tests/fixtures/colors.gif', import.meta.url));
  await page.locator('.image-file').setInputFiles([
    ...[0, 1].map(index => ({ name: `offline-photo-${index}.png`, mimeType: 'image/png', buffer: imageBytes })),
    { name: 'offline-cycle.gif', mimeType: 'image/gif', buffer: gifBytes },
  ]);
  await page.waitForFunction(() => document.querySelector('.studio')?.dataset.imageCount === '3' && document.querySelector('.studio')?.dataset.state === 'paused');
  assert.equal(await page.locator('.studio').getAttribute('data-has-image'), 'true', 'Portable local image import must work with networking blocked.');
  assert.equal(await page.locator('.image-film-source .image-item').count(), 3);
  assert.equal(await page.locator('.image-film-source .image-gif-badge').count(), 1);
  const gifColors = await page.evaluate(() => {
    const seek = document.querySelector('.progress-track');
    const end = Number(seek.max);
    const reference = document.createElement('canvas'); reference.width = 1; reference.height = 1;
    const context = reference.getContext('2d', { willReadFrequently: true });
    const canvas = document.querySelector('.stage canvas');
    return [0.1, 0.35, 0.75].map(offset => {
      seek.value = String(end - 1.75 + offset);
      seek.dispatchEvent(new Event('input', { bubbles: true }));
      context.drawImage(canvas, canvas.width / 2, canvas.height / 2, 1, 1, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
  });
  assert.deepEqual(gifColors, [[255, 0, 0], [0, 255, 0], [0, 0, 255]], 'The portable GIF must animate from the film timeline.');
  let exportResult = 'honestly unavailable';
  let giphyExport = 'not requested';
  let audioResult = 'unavailable';
  let audioEnergy = 0;
  if (await page.locator('.download-button').isEnabled()) {
    const finished = page.waitForEvent('download');
    await page.locator('.download-button').click();
    const downloaded = await finished;
    assert.ok(downloaded.suggestedFilename().length <= 76, 'The filename cap includes the extension.');
    assert.ok(downloaded.suggestedFilename().startsWith('Créons ensemble'), 'Export is named from the film text.');
    const bytes = await readFile(await downloaded.path());
    if (downloaded.suggestedFilename().endsWith('.mp4')) assert.equal(bytes.subarray(4, 8).toString('ascii'), 'ftyp');
    else assert.deepEqual([...bytes.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
    const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [MP4, WEBM] });
    try {
      const audio = await input.getPrimaryAudioTrack();
      assert.ok(audio, 'The portable export must contain its selected soundtrack.');
      audioResult = await audio.getCodec();
      assert.equal(audioResult, downloaded.suggestedFilename().endsWith('.mp4') ? 'aac' : 'opus');
      assert.equal(await audio.getSampleRate(), 48000);
    } finally { input.dispose(); }
    audioEnergy = await page.evaluate(async encoded => {
      const context = new AudioContext({ sampleRate: 48000 });
      try {
        const raw = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        const buffer = await context.decodeAudioData(raw.buffer);
        const samples = buffer.getChannelData(0);
        let square = 0, count = 0;
        for (let index = Math.round(0.2 * buffer.sampleRate); index < Math.min(samples.length, Math.round(1.8 * buffer.sampleRate)); index++) {
          square += samples[index] ** 2; count++;
        }
        return Math.sqrt(square / count);
      } finally { await context.close(); }
    }, bytes.toString('base64'));
    assert.ok(audioEnergy > 0.01, 'The portable export must contain audible decoded Générique de fin music, not merely audio metadata.');
    await page.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'paused');
    exportResult = downloaded.suggestedFilename().split('.').pop();
  }
  if (liveGiphy) {
    const previousEnd = Number(await page.locator('.progress-track').getAttribute('max'));
    await page.locator('.image-film-button').click();
    await page.locator('.giphy-search-input').fill('celebration');
    await page.locator('.giphy-search-button').click();
    await page.locator('.giphy-result').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('.giphy-result').first().click();
    await page.waitForFunction(() => document.querySelector('.studio')?.dataset.imageCount === '4', null, { timeout: 60000 });
    assert.equal(await page.locator('.image-film-attributions a').first().textContent(), 'GIPHY');
    const distinctFrames = await page.evaluate(previousEnd => {
      const seek = document.querySelector('.progress-track');
      const hold = Number(seek.max) - previousEnd - 0.7;
      const canvas = document.querySelector('.stage canvas');
      const capture = document.createElement('canvas'); capture.width = canvas.width; capture.height = canvas.height;
      const context = capture.getContext('2d');
      const frames = Array.from({ length: 10 }, (_, index) => {
        seek.value = String(previousEnd - 0.05 + hold * (index + 0.5) / 10);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        context.drawImage(canvas, 0, 0);
        return capture.toDataURL('image/png');
      });
      return new Set(frames).size;
    }, previousEnd);
    assert.ok(distinctFrames > 1, 'A live GIPHY selection must remain animated in the production portable page.');
    if (await page.locator('.download-button').isEnabled()) {
      const expectedDuration = Number(await page.locator('.progress-track').getAttribute('max'));
      const finished = page.waitForEvent('download');
      await page.locator('.download-button').click();
      const downloaded = await finished;
      const bytes = await readFile(await downloaded.path());
      const input = new Input({ source: new BlobSource(new Blob([bytes])), formats: [MP4, WEBM] });
      try {
        const video = await input.getPrimaryVideoTrack();
        assert.ok(video, 'The exported GIPHY film must contain a video track.');
        assert.equal(await video.getDisplayWidth(), 1080);
        assert.equal(await video.getDisplayHeight(), 1920);
        assert.ok(Math.abs(await input.computeDuration() - expectedDuration) < 0.05, 'The exported film must include the appended GIPHY ending.');
        assert.ok(await input.getPrimaryAudioTrack(), 'The exported GIPHY film must retain its soundtrack.');
        giphyExport = downloaded.suggestedFilename().split('.').pop();
      } finally { input.dispose(); }
      await page.waitForFunction(() => document.querySelector('.studio')?.dataset.state === 'paused');
    }
  }
  await page.screenshot({ path: new URL('portable.png', directory).pathname });
  assert.deepEqual(errors, [], 'Portable film must render without uncaught errors.');
  assert.deepEqual(requests, [], 'Portable film must not attempt runtime downloads.');
  console.log(JSON.stringify({ file: file.pathname, externalRequests: requests.length, pageErrors: errors.length, welcomeAnimation: 'passed', help: 'passed', playback: 'passed', portrait: 'passed', productionIsolation: 'passed', freeInput: 'passed', examples: 'passed', filename: 'passed', monochromeEmoji: 'passed', remix: 'passed', themes: 'passed', systemAppearance: 'passed', finalImages: 'passed', animatedGif: 'passed', giphySearch: liveGiphy ? 'passed' : 'not requested', giphyRequests, giphyExport, export: exportResult, audio: audioResult, audioLibrary: audioIds, audioCredits: 'passed', audioSource: 'meme-de-creditos-finales', audioEnergy }));
} finally {
  await browser.close();
}
