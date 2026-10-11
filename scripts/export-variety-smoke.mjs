import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Development-only inspection of actual generated films, without retiming or
// modifying their scene specification. Nothing here is shipped in the app.
const url = process.argv[2] || 'http://127.0.0.1:5174/';
const seed = Number(process.argv[3] || 42);
const text = process.argv[4] || 'Less noise. More meaning. Make your words impossible to ignore.';
const forceWebm = process.env.CREACTORS_EXPORT_WEBM === '1';
const directory = new URL('../artifacts/export-variety/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  if (forceWebm) await page.addInitScript(() => {
    const nativeSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc1.')
      ? Promise.resolve({ supported: false, config }) : nativeSupport(config);
  });
  await page.goto(url);
  const report = await page.evaluate(async ({ seed, text }) => {
    await window.__CREACTORS_DEV__.ready;
    const dev = window.__CREACTORS_DEV__;
    await dev.generate(text, seed, 'en');
    const spec = dev.spec;
    const [{ VideoExporter }, media] = await Promise.all([
      import('/src/export/video-exporter.ts'),
      import('/node_modules/mediabunny/dist/modules/src/index.js'),
    ]);
    const expectedFrames = Math.ceil(spec.duration * 30);
    const samplePoints = [];
    function sample(label, time) {
      const frame = Math.max(0, Math.min(expectedFrames - 1, Math.round(time * 30)));
      samplePoints.push({ label, frame, time: frame / 30 });
    }
    const entrance = spec.objects.find(object => object.entrance?.rotation);
    if (entrance) {
      sample('entrance-rotation', entrance.entrance.start + (entrance.entrance.end - entrance.entrance.start) * 0.72);
      sample('entrance-settle', entrance.entrance.end);
    }
    const roll = spec.cameraTracks.find(track => track.rollTurns);
    if (roll) sample('camera-roll', roll.start + (roll.end - roll.start) * 0.31);
    const impactObject = spec.objects.find(object => object.impact);
    if (impactObject) sample('object-impact', impactObject.impact.start + (impactObject.impact.end - impactObject.impact.start) * 0.2);
    const impactCamera = spec.cameraTracks.find(track => track.impact);
    if (impactCamera) sample('camera-impact', impactCamera.impact.start + (impactCamera.impact.end - impactCamera.impact.start) * 0.2);
    const reveal = spec.cameraTracks.find(track => track.primitive === 'REVEAL');
    if (reveal) sample('reveal', reveal.start + (reveal.end - reveal.start) * 0.6);
    sample('poster', spec.posterTime ?? spec.duration * 0.8);
    const exit = spec.objects.find(object => object.exit?.rotation);
    if (exit) {
      sample('exit-rotation-start', exit.exit.start + (exit.exit.end - exit.exit.start) * 0.12);
      sample('exit-rotation', exit.exit.start + (exit.exit.end - exit.exit.start) * 0.45);
    }
    sample('empty-opening', 0);
    sample('loop-seam', (expectedFrames - 1) / 30);

    const transform = () => ({
      camera: { position: dev.renderer.camera.position.toArray(), quaternion: dev.renderer.camera.quaternion.toArray() },
      objects: dev.renderer.objectRoots.map(root => ({ position: root.position.toArray(), rotation: root.rotation.toArray().slice(0, 3), scale: root.scale.toArray() })),
    });
    const wanted = new Map(samplePoints.map(point => [point.time, point]));
    const previewStates = new Map();
    for (const { time } of samplePoints) { dev.seek(time); previewStates.set(time, JSON.stringify(transform())); }
    let historyIndependent = true;
    for (const { time } of [...samplePoints].reverse()) {
      dev.seek(time);
      historyIndependent &&= JSON.stringify(transform()) === previewStates.get(time);
    }
    dev.seek(1.2);
    const beforeSize = dev.renderer.getSize();
    const beforeTime = dev.renderer.lastTime;
    const originalRender = dev.renderer.renderFrame;
    const exportedStates = new Map();
    dev.renderer.renderFrame = function(time) {
      originalRender.call(this, time);
      if (wanted.has(time)) exportedStates.set(time, JSON.stringify(transform()));
    };
    const started = performance.now();
    let result;
    try { result = await new VideoExporter().export(dev.renderer, spec); }
    finally { dev.renderer.renderFrame = originalRender; }
    const elapsedMs = performance.now() - started;
    const afterSize = dev.renderer.getSize();
    const afterTime = dev.renderer.lastTime;
    const stateMatches = [...previewStates].every(([time, state]) => exportedStates.get(time) === state);
    const input = new media.Input({ source: new media.BlobSource(result.blob), formats: [media.MP4, media.WEBM] });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('The generated export has no video track.');
      let frameCount = 0, maxTimestampError = 0, keyframes = 0;
      for await (const packet of new media.EncodedPacketSink(track).packets()) {
        maxTimestampError = Math.max(maxTimestampError, Math.abs(packet.timestamp - frameCount / 30));
        frameCount++;
        if (packet.type === 'key') keyframes++;
      }
      const decodedFrames = new media.VideoSampleSink(track);
      const reference = document.createElement('canvas'), decoded = document.createElement('canvas');
      reference.width = decoded.width = 144;
      reference.height = decoded.height = 256;
      const referenceContext = reference.getContext('2d', { willReadFrequently: true });
      const decodedContext = decoded.getContext('2d', { willReadFrequently: true });
      const comparisons = [];
      dev.renderer.resize(result.width, result.height);
      try {
        for (const point of samplePoints) {
          // WebM stores millisecond timestamps; request just after the nearest
          // rounding boundary so getSample() selects this same frame.
          const frame = await decodedFrames.getSample(point.time + 0.0006);
          if (!frame) throw new Error(`Missing ${point.label} frame.`);
          try {
            dev.renderer.renderFrame(point.time);
            referenceContext.drawImage(dev.renderer.canvas, 0, 0, 144, 256);
            frame.draw(decodedContext, 0, 0, 144, 256);
            const a = referenceContext.getImageData(0, 0, 144, 256).data;
            const b = decodedContext.getImageData(0, 0, 144, 256).data;
            let difference = 0, visiblePixels = 0;
            for (let index = 0; index < a.length; index += 4) {
              difference += Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2]);
              if (a[index] > 45 || a[index + 1] > 45 || a[index + 2] > 70) visiblePixels++;
            }
            comparisons.push({ ...point, decodedTime: frame.timestamp, timestampError: Math.abs(frame.timestamp - point.time), meanRgbDifference: difference / (144 * 256 * 3), visiblePixels });
          } finally { frame.close(); }
        }
      } finally { dev.renderer.resize(...beforeSize); dev.renderer.renderFrame(beforeTime); }
      const blobUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `creactors-variety-${seed}.${result.format}`;
      document.body.append(anchor);
      window.__VARIETY_DOWNLOAD__ = { anchor, blobUrl };
      return {
        seed, text, generatorVersion: spec.generatorVersion, directionStyle: spec.directionStyle,
        duration: spec.duration, encodedDuration: await input.computeDuration(),
        expectedFrames, frameCount, maxTimestampError, keyframes,
        format: result.format, codec: await track.getCodecParameterString(),
        width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
        bytes: result.blob.size, elapsedMs, historyIndependent, stateMatches,
        beforeSize, afterSize, beforeTime, afterTime, comparisons,
        motion: { entranceRotation: Boolean(entrance), cameraRoll: Boolean(roll), objectImpact: Boolean(impactObject), cameraImpact: Boolean(impactCamera), exitRotation: Boolean(exit) },
      };
    } finally { input.dispose(); }
  }, { seed, text });
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.__VARIETY_DOWNLOAD__.anchor.click());
  const download = await downloadPromise;
  await download.saveAs(new URL(`creactors-variety-${seed}.${report.format}`, directory).pathname);
  await page.evaluate(() => {
    window.__VARIETY_DOWNLOAD__.anchor.remove();
    URL.revokeObjectURL(window.__VARIETY_DOWNLOAD__.blobUrl);
  });
  assert.equal(report.frameCount, report.expectedFrames);
  assert.ok(Math.abs(report.encodedDuration - report.expectedFrames / 30) < 0.001);
  assert.ok(report.maxTimestampError < (report.format === 'mp4' ? 1e-9 : 0.001));
  assert.equal(report.width, 1080);
  assert.equal(report.height, 1920);
  assert.equal(report.historyIndependent, true);
  assert.equal(report.stateMatches, true);
  assert.deepEqual(report.afterSize, report.beforeSize);
  assert.equal(report.afterTime, report.beforeTime);
  assert.ok(report.motion.entranceRotation, 'Select a seed with an actual entrance rotation.');
  assert.ok(report.motion.cameraRoll, 'Select a seed with an actual camera roll.');
  assert.ok(report.motion.objectImpact || report.motion.cameraImpact, 'Select a seed with an actual impact.');
  assert.ok(report.motion.exitRotation, 'Select a seed with an actual exit rotation.');
  assert.ok(report.comparisons.every(frame => frame.timestampError < 0.001));
  assert.ok(report.comparisons.every(frame => frame.meanRgbDifference < 3), 'Decoded moving frames must match the scene.');
  assert.ok(report.comparisons.some(frame => frame.visiblePixels > 300));
  assert.deepEqual(pageErrors, []);
  await writeFile(new URL(`variety-${seed}-${report.format}.json`, directory), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
