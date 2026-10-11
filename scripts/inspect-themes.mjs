import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Development-only visual review; no browser editing tools ship in production.
const previewUrl = process.argv[2] || 'http://127.0.0.1:5174/';
const families = ['califormandy-sunset', 'monochrome', 'coral-night', 'cobalt', 'orchid', 'acid'];
const quote = "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.";
const directory = new URL('../artifacts/themes/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const reports = [];
const posters = [];
const automaticPosters = [];
const errors = [];
const externalRequests = [];

try {
  for (const colorScheme of ['dark', 'light']) {
    for (const [device, viewport] of [['desktop', { width: 1440, height: 1100 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport, colorScheme, reducedMotion: 'reduce' });
      page.on('pageerror', error => errors.push({ colorScheme, device, message: String(error) }));
      page.on('request', request => {
        const url = new URL(request.url());
        if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalRequests.push(url.href);
      });
      await page.goto(previewUrl);
      await page.waitForFunction(() => Boolean(window.__CREACTORS_DEV__?.ready));
      await page.evaluate(() => window.__CREACTORS_DEV__.ready);
      await page.screenshot({ path: new URL(`${device}-${colorScheme}-input.png`, directory).pathname, fullPage: true });
      await page.evaluate(async text => window.__CREACTORS_DEV__.generate(text, 42), quote);
      await page.evaluate(() => window.__CREACTORS_DEV__.seek(window.__CREACTORS_DEV__.spec.posterTime));

      const ui = await page.evaluate(() => {
        const rgba = value => {
          const components = value.match(/[\d.]+/g)?.map(Number) || [];
          return components.length >= 3 ? [components[0], components[1], components[2], components[3] ?? 1] : [0, 0, 0, 0];
        };
        const blend = (front, back) => [0, 1, 2].map(axis => front[axis] * front[3] + back[axis] * (1 - front[3])).concat(1);
        const backgroundOf = element => {
          const chain = [];
          for (let node = element; node; node = node.parentElement) chain.unshift(node);
          return chain.reduce((background, node) => blend(rgba(getComputedStyle(node).backgroundColor), background), [255, 255, 255, 1]);
        };
        const luminance = color => color.slice(0, 3).reduce((sum, value, axis) => {
          const srgb = value / 255;
          const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          return sum + linear * [0.2126, 0.7152, 0.0722][axis];
        }, 0);
        const contrast = (foreground, background) => {
          const a = luminance(foreground); const b = luminance(background);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const bounds = element => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
          return { x, y, width, height, right, bottom };
        };
        const contrastSelectors = ['.brand', '.tagline', '.locale-switch button', '.quote-input', '.create-button', '.timecode', '.timecode > span', '.icon-button', '.film-meta', '.studio-footer'];
        const contrasts = contrastSelectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getBoundingClientRect().width && element.getBoundingClientRect().height).map(element => {
          const computed = getComputedStyle(element);
          const background = backgroundOf(element);
          const foreground = blend(rgba(computed.color), background);
          return { selector, label: element.getAttribute('aria-label') || element.textContent.trim(), pressed: element.getAttribute('aria-pressed'), foreground, background, ratio: contrast(foreground, background) };
        }));
        const swatches = [...document.querySelectorAll('button[data-theme]')].map(element => ({ family: element.dataset.theme, label: element.getAttribute('aria-label'), pressed: element.getAttribute('aria-pressed'), bounds: bounds(element) }));
        const stage = bounds(document.querySelector('.stage'));
        const playback = bounds(document.querySelector('.playback'));
        return { themeId: window.__CREACTORS_DEV__.spec.themeId, rootAppearance: document.documentElement.dataset.colorScheme || document.documentElement.dataset.appearance || null, computedColorScheme: getComputedStyle(document.documentElement).colorScheme, pageBackground: getComputedStyle(document.documentElement).backgroundColor, viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, stage, playback, swatches, contrasts };
      });
      const failures = [];
      if (ui.documentWidth > viewport.width + 1) failures.push({ reason: 'horizontal-document-overflow', width: ui.documentWidth });
      if (device === 'mobile' && ui.playback.bottom > viewport.height - 15) failures.push({ reason: 'playback-below-viewport', bottom: ui.playback.bottom });
      for (const family of families) {
        const swatch = ui.swatches.find(swatch => swatch.family === family);
        if (!swatch) failures.push({ reason: 'missing-family-swatch', family });
        else {
          if (!swatch.label) failures.push({ reason: 'unlabelled-swatch', family });
          if (swatch.bounds.width < 43.9 || swatch.bounds.height < 43.9) failures.push({ reason: 'small-touch-target', family, bounds: swatch.bounds });
        }
      }
      await page.screenshot({ path: new URL(`${device}-${colorScheme}-film.png`, directory).pathname, fullPage: true });
      if (device === 'desktop') {
        for (const family of families) {
          await page.locator(`button[data-theme="${family}"]`).click();
          const film = await page.evaluate(() => {
            const api = window.__CREACTORS_DEV__;
            return { themeId: api.spec.themeId, time: api.spec.posterTime, data: null };
          });
          const expectedId = colorScheme === 'light' ? `${family}-light` : family;
          if (film.themeId !== expectedId) failures.push({ reason: 'wrong-resolved-theme', family, expected: expectedId, actual: film.themeId });
          const data = await page.evaluate(time => window.__CREACTORS_DEV__.capture(time), film.time);
          const name = `poster-${family}-${colorScheme}.png`;
          await writeFile(new URL(name, directory), Buffer.from(data.split(',')[1], 'base64'));
          posters.push({ family, colorScheme, name, data });
        }
        await page.locator('button[data-theme="auto"]').click();
        for (const seed of [1, 2, 3, 42, 55, 2026, 20261010, 0xFFFFFFFF]) {
          await page.evaluate(async ({ quote, seed }) => window.__CREACTORS_DEV__.generate(quote, seed), { quote, seed });
          const palette = await page.evaluate(async () => {
            const api = window.__CREACTORS_DEV__;
            const { getTheme, getThemeFamilyId, contrastRatio } = await import('/src/themes/index.ts');
            const theme = getTheme(api.spec.themeId);
            return { theme, family: getThemeFamilyId(theme.id), time: api.spec.posterTime, contrasts: Object.values(theme.colors).map(color => contrastRatio(color, theme.background)) };
          });
          if (palette.contrasts.some(ratio => ratio < 4.5)) failures.push({ reason: 'unreadable-generated-ink', seed, palette });
          if (!palette.theme.id.includes('~')) failures.push({ reason: 'automatic-color-variant-missing', seed, palette });
          const data = await page.evaluate(time => window.__CREACTORS_DEV__.capture(time), palette.time);
          const name = `poster-auto-${seed}-${colorScheme}.png`;
          await writeFile(new URL(name, directory), Buffer.from(data.split(',')[1], 'base64'));
          automaticPosters.push({ seed, colorScheme, name, data, ...palette });
        }
      }
      reports.push({ device, colorScheme, ui, failures });
      console.log(`Reviewed ${device} ${colorScheme}: ${ui.themeId}, ${ui.documentWidth}px document width; ${failures.length} failures.`);
      await page.close();
    }
  }

  const sheetPage = await browser.newPage();
  const composeSheet = async (items, columns) => sheetPage.evaluate(async ({ items, columns }) => {
    const canvas = document.createElement('canvas');
    const width = 180; const height = 320; const header = 30;
    canvas.width = width * columns; canvas.height = (height + header) * Math.ceil(items.length / columns);
    const context = canvas.getContext('2d');
    context.fillStyle = '#111126'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < items.length; index++) {
      const poster = items[index];
      const x = index % columns * width; const y = Math.floor(index / columns) * (height + header);
      context.fillStyle = '#ede8fa'; context.font = '12px sans-serif';
      context.fillText(`${poster.seed === undefined ? poster.family : `${poster.seed} · ${poster.family}`} · ${poster.colorScheme}`, x + 6, y + 18, width - 12);
      const image = new Image(); image.src = poster.data; await image.decode();
      context.drawImage(image, x, y + header, width, height);
    }
    return canvas.toDataURL('image/png');
  }, { items, columns });
  const sheet = await composeSheet(posters, 6);
  await writeFile(new URL('contact.png', directory), Buffer.from(sheet.split(',')[1], 'base64'));
  const automaticSheet = await composeSheet(automaticPosters, 4);
  await writeFile(new URL('automatic-contact.png', directory), Buffer.from(automaticSheet.split(',')[1], 'base64'));
  const summary = { errors, externalRequests, failures: reports.flatMap(report => report.failures.map(failure => ({ device: report.device, colorScheme: report.colorScheme, ...failure }))), reports, automaticPalettes: automaticPosters.map(({ data, ...palette }) => palette) };
  await writeFile(new URL('report.json', directory), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ errors, externalRequests, failures: summary.failures }, null, 2));
  if (summary.failures.length || errors.length || externalRequests.length) process.exitCode = 1;
} finally {
  await browser.close();
}
