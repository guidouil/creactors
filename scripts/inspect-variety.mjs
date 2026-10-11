import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Developer-only visual review. Run against Vite, whose inspection API is not
// included in the portable production build.
const previewUrl = process.argv[2] || 'http://127.0.0.1:5174/';
const seedCount = Number(process.argv[3] || 12);
if (!Number.isInteger(seedCount) || seedCount < 8 || seedCount > 40) throw new RangeError('Use 8–40 review seeds.');
const quote = "Le futur n'est pas ce qui nous attend. C'est ce que nous créons.";
const directory = new URL('../artifacts/variety/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const reports = [];
const rows = [];
const errors = [];
const externalRequests = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) externalRequests.push(url.href);
  });
  await page.goto(previewUrl);
  await page.waitForFunction(() => Boolean(window.__CREACTORS_DEV__?.ready));
  await page.evaluate(() => window.__CREACTORS_DEV__.ready);

  for (let seed = 1; seed <= seedCount; seed++) {
    const result = await page.evaluate(async ({ text, seed }) => {
      const api = window.__CREACTORS_DEV__;
      await api.generate(text, seed);
      const spec = api.spec;
      const failures = [];
      const readingBounds = [];
      const framePixels = (time, stride = 4) => {
        api.seek(time);
        const gl = api.renderer.renderer.getContext();
        const [width, height] = api.renderer.getSize();
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const background = pixels.slice(0, 3);
        let ink = 0;
        for (let index = 0; index < pixels.length; index += stride) {
          if (Math.abs(pixels[index] - background[0]) + Math.abs(pixels[index + 1] - background[1]) + Math.abs(pixels[index + 2] - background[2]) > 12) ink++;
        }
        return { ink, background: [...background] };
      };
      const safe = box => box.min[0] >= -0.85 && box.max[0] <= 0.85 && box.min[1] >= -0.65 && box.max[1] <= 0.76 && box.min[2] >= -1 && box.max[2] <= 1;
      for (const object of spec.objects) {
        for (const fraction of [0.12, 0.5, 0.88]) {
          const time = object.readingInterval[0] + (object.readingInterval[1] - object.readingInterval[0]) * fraction;
          api.seek(time);
          const box = api.bounds().find(box => box.id === object.id);
          readingBounds.push({ time, id: object.id, min: box.min, max: box.max });
          if (!safe(box)) failures.push({ reason: 'reading-safe-area', time, box });
        }
      }
      api.seek(spec.posterTime);
      const posterBounds = api.bounds().filter(box => box.max[0] > -1 && box.min[0] < 1 && box.max[1] > -1 && box.min[1] < 1 && box.max[2] <= 1);
      for (const box of posterBounds) if (!safe(box)) failures.push({ reason: 'poster-safe-area', box });
      const opening = framePixels(0);
      const ending = [spec.duration - 2 / spec.fps, spec.duration - 1 / spec.fps, spec.duration].map(time => ({ time, ...framePixels(time) }));
      if (opening.ink) failures.push({ reason: 'opening-not-empty', ...opening });
      for (const frame of ending) if (frame.ink || JSON.stringify(frame.background) !== JSON.stringify(opening.background)) failures.push({ reason: 'loop-not-empty', ...frame });
      // Sample every frame: a full roll must be evaluated from absolute time,
      // without singular/non-finite transforms or dependence on seek history.
      let maximumCameraTurn = 0;
      let cumulativeCameraTurn = 0;
      let maximumObjectTurn = 0;
      const blankTravelRuns = [];
      let blankTravelStart = null;
      let previous;
      for (let frame = 0; frame <= Math.ceil(spec.duration * spec.fps); frame++) {
        const time = Math.min(spec.duration, frame / spec.fps);
        api.seek(time);
        const state = api.state();
        const values = [...state.camera.position, ...state.camera.quaternion, ...state.objects.flatMap(object => [...object.position, ...object.rotation, object.scale])];
        if (!values.every(Number.isFinite)) failures.push({ reason: 'non-finite-transform', time });
        if (previous) {
          const dot = state.camera.quaternion.reduce((sum, value, axis) => sum + value * previous.camera.quaternion[axis], 0);
          const turn = 2 * Math.acos(Math.min(1, Math.abs(dot)));
          maximumCameraTurn = Math.max(maximumCameraTurn, turn);
          cumulativeCameraTurn += turn;
        }
        maximumObjectTurn = Math.max(maximumObjectTurn, ...state.objects.map(object => Math.hypot(...object.rotation)));
        const track = spec.cameraTracks.find(track => track.id === state.trackId);
        // An actual glyph-counter crossing may intentionally fill the frame
        // with negative space. Other continuous journeys and reveals must
        // retain visible typography instead of becoming accidental blank cuts.
        const travel = track.start >= spec.objects[0].readingInterval[1] - 0.0001 && !['HOLD', 'CUT', 'PORTAL'].includes(track.primitive) && !/^portal|rush|exit|seam|finale/.test(track.id);
        const blankTravel = travel && framePixels(time, 8).ink === 0;
        if (blankTravel && blankTravelStart === null) blankTravelStart = time;
        if (!blankTravel && blankTravelStart !== null) {
          blankTravelRuns.push({ start: blankTravelStart, end: time, duration: time - blankTravelStart });
          blankTravelStart = null;
        }
        previous = state;
      }
      for (const run of blankTravelRuns) if (run.duration > 0.1001) failures.push({ reason: 'unintended-empty-movement', ...run });
      const movingTracks = spec.cameraTracks.filter(track => track.start >= spec.objects[0].readingInterval[1] - 0.0001 && !['HOLD', 'CUT'].includes(track.primitive) && !/rush|exit|seam|reveal|finale/.test(track.id));
      const rotationTrack = movingTracks.find(track => track.rollTurns) || movingTracks.find(track => track.primitive === 'ORBIT') || movingTracks[0] || spec.cameraTracks[0];
      const reveal = spec.cameraTracks.find(track => /reveal/.test(track.id)) || spec.cameraTracks.find(track => track.primitive === 'REVEAL');
      const exitStarts = spec.objects.flatMap(object => object.exit ? [object.exit.start] : []);
      const exitEnds = spec.objects.flatMap(object => object.exit ? [object.exit.end] : []);
      const exitStart = Math.min(...exitStarts);
      const exitEnd = Math.max(...exitEnds);
      const impactObjects = spec.objects.filter(object => object.impact);
      const impact = impactObjects[0]?.impact;
      const entrance = spec.objects[0].entrance;
      let entranceTime = entrance.end * 0.9;
      const minimumVisibleInk = api.renderer.getSize().reduce((a, b) => a * b) * 0.004;
      for (let frame = Math.ceil(entrance.start * spec.fps); frame <= Math.floor(entrance.end * spec.fps); frame++) {
        const time = frame / spec.fps;
        if (framePixels(time).ink > minimumVisibleInk) { entranceTime = time; break; }
      }
      const times = [
        { label: 'Entrée', time: entranceTime },
        { label: 'Rotation / voyage', time: (rotationTrack.start + rotationTrack.end) / 2 },
        { label: 'Révélation', time: reveal ? reveal.start + (reveal.end - reveal.start) * 0.52 : spec.posterTime },
        { label: 'Impact', time: impact ? impact.start + (impact.end - impact.start) * 0.22 : spec.posterTime },
        { label: 'Sortie 35%', time: exitStart + (exitEnd - exitStart) * 0.35 },
        { label: 'Sortie 65%', time: exitStart + (exitEnd - exitStart) * 0.65 },
      ];
      const probe = times[1].time;
      api.seek(probe);
      const direct = JSON.stringify(api.state());
      for (const time of [spec.duration, 0, spec.posterTime, probe]) api.seek(time);
      if (JSON.stringify(api.state()) !== direct) failures.push({ reason: 'seek-not-deterministic', time: probe });
      return {
        seed, duration: spec.duration, directionStyle: spec.directionStyle || null,
        structuralSignature: spec.structuralSignature || null, primitives: spec.cameraTracks.map(track => track.primitive),
        rollTurns: spec.cameraTracks.flatMap(track => track.rollTurns ? [{ id: track.id, turns: track.rollTurns }] : []),
        maximumCameraTurn, cumulativeCameraTurn, maximumObjectTurn, blankTravelRuns, opening, ending, readingBounds, posterBounds, failures, times,
      };
    }, { text: quote, seed });

    const frames = [];
    for (let index = 0; index < result.times.length; index++) {
      const frame = result.times[index];
      const data = await page.evaluate(time => window.__CREACTORS_DEV__.capture(time), frame.time);
      const name = `seed-${String(seed).padStart(2, '0')}-${index + 1}.png`;
      await writeFile(new URL(name, directory), Buffer.from(data.split(',')[1], 'base64'));
      frames.push({ ...frame, name, data });
    }
    rows.push({ seed, directionStyle: result.directionStyle, frames });
    reports.push(result);
    console.log(`Reviewed seed ${seed}/${seedCount}: ${JSON.stringify(result.directionStyle)}; failures ${result.failures.length}.`);
  }

  // Three readable contact sheets instead of one enormous image. Raw 1080p
  // captures remain available next to them for close inspection.
  for (let offset = 0; offset < rows.length; offset += 4) {
    const data = await page.evaluate(async rows => {
      const width = 1080; const tileWidth = 180; const tileHeight = 320;
      const rowHeight = 374;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = rows.length * rowHeight;
      const context = canvas.getContext('2d');
      context.fillStyle = '#111126'; context.fillRect(0, 0, canvas.width, canvas.height);
      for (let row = 0; row < rows.length; row++) {
        const item = rows[row]; const y = row * rowHeight;
        context.fillStyle = '#ede8fa'; context.font = '15px sans-serif';
        const style = item.directionStyle ? Object.entries(item.directionStyle).map(([key, value]) => `${key}: ${value}`).join(' · ') : '';
        context.fillText(`Seed ${item.seed} · ${style}`, 8, y + 19, width - 16);
        for (let column = 0; column < item.frames.length; column++) {
          const frame = item.frames[column];
          const image = new Image(); image.src = frame.data; await image.decode();
          context.drawImage(image, column * tileWidth, y + 28, tileWidth, tileHeight);
          context.fillStyle = '#ede8fa'; context.font = '12px sans-serif';
          context.fillText(`${frame.label} · ${frame.time.toFixed(2)}s`, column * tileWidth + 7, y + 367, tileWidth - 14);
        }
      }
      return canvas.toDataURL('image/png');
    }, rows.slice(offset, offset + 4));
    await writeFile(new URL(`contact-${offset / 4 + 1}.png`, directory), Buffer.from(data.split(',')[1], 'base64'));
  }

  const dimensionCounts = {};
  for (const report of reports) for (const [key, value] of Object.entries(report.directionStyle || {})) (dimensionCounts[key] ||= new Set()).add(value);
  const variation = Object.fromEntries(Object.entries(dimensionCounts).map(([key, values]) => [key, [...values]]));
  const failures = reports.flatMap(report => report.failures.map(failure => ({ seed: report.seed, ...failure })));
  const emptyTravel = reports.flatMap(report => report.blankTravelRuns.map(run => ({ seed: report.seed, ...run })));
  const summary = { quote, scenes: reports.length, variation, emptyTravel, errors, externalRequests, failures };
  await writeFile(new URL('report.json', directory), JSON.stringify({ ...summary, reports }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length || errors.length || externalRequests.length) process.exitCode = 1;
} finally {
  await browser.close();
}
