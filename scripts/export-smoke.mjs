import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Development-only validation. Decoders and media inspection never ship in UI.
const url = process.argv[2] || process.env.CREACTORS_PREVIEW_URL || 'http://127.0.0.1:5173/';
const durations = process.argv[3]?.split(',').map(Number) || [12];
const directory = new URL('../artifacts/export/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  if (process.env.CREACTORS_EXPORT_WEBM === '1') {
    await page.addInitScript(() => {
      const original = VideoEncoder.isConfigSupported.bind(VideoEncoder);
      VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc1.')
        ? Promise.resolve({ supported: false, config }) : original(config);
    });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async () => { await window.__CREACTORS_DEV__.ready; window.__CREACTORS_DEV__.seek(1.4); });
  const results = [];
  for (const duration of durations) {
    const metrics = await page.evaluate(async ({ duration, preferredHeight }) => {
      const { VideoExporter } = await import('/src/export/video-exporter.ts');
      const { Input, BlobSource, MP4, WEBM, EncodedPacketSink, VideoSampleSink } = await import('/node_modules/mediabunny/dist/modules/src/index.js');
      const dev = window.__CREACTORS_DEV__;
      const originalSpec = dev.spec;
      const ratio = duration / originalSpec.duration;
      const range = ([from, to]) => [from * ratio, to * ratio];
      const timed = value => value ? { ...value, start: value.start * ratio, end: value.end * ratio } : undefined;
      const spec = {
        ...originalSpec,
        duration,
        objects: originalSpec.objects.map(object => ({ ...object, readingInterval: range(object.readingInterval), entrance: timed(object.entrance), assembly: timed(object.assembly), exit: timed(object.exit) })),
        cameraTracks: originalSpec.cameraTracks.map(track => ({ ...track, start: track.start * ratio, end: track.end * ratio })),
      };
      await dev.renderer.prepare(spec);
      dev.renderer.renderFrame(1.4 * ratio);
      const start = performance.now();
      const exportResult = await new VideoExporter().export(dev.renderer, spec, { preferredHeight });
      const elapsed = performance.now() - start;
      const input = new Input({ source: new BlobSource(exportResult.blob), formats: [MP4, WEBM] });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('Export has no video track.');
        const sink = new EncodedPacketSink(track);
        let count = 0;
        const keyframes = [];
        let finalTimestamp = 0;
        for await (const packet of sink.packets()) {
          count++;
          finalTimestamp = Math.max(finalTimestamp, packet.timestamp);
          if (packet.type === 'key') keyframes.push(packet.timestamp);
        }
        const samples = new VideoSampleSink(track);
        const comparisons = [];
        const reference = document.createElement('canvas');
        const decoded = document.createElement('canvas');
        reference.width = decoded.width = 72;
        reference.height = decoded.height = 128;
        const referenceContext = reference.getContext('2d', { willReadFrequently: true });
        const decodedContext = decoded.getContext('2d', { willReadFrequently: true });
        const size = dev.renderer.getSize();
        dev.renderer.resize(exportResult.width, exportResult.height);
        for (const targetTime of [0, 1.4 * ratio, 5.7 * ratio, duration - 1 / 30]) {
          const sample = await samples.getSample(targetTime);
          if (!sample) throw new Error(`No decoded frame at ${targetTime}.`);
          try {
            dev.renderer.renderFrame(sample.timestamp);
            referenceContext.drawImage(dev.renderer.canvas, 0, 0, 72, 128);
            sample.draw(decodedContext, 0, 0, 72, 128);
            const a = referenceContext.getImageData(0, 0, 72, 128).data;
            const b = decodedContext.getImageData(0, 0, 72, 128).data;
            let difference = 0;
            let visiblePixels = 0;
            for (let i = 0; i < a.length; i += 4) {
              difference += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
              if (a[i] > 45 || a[i + 1] > 45 || a[i + 2] > 70) visiblePixels++;
            }
            comparisons.push({ time: sample.timestamp, meanRgbDifference: difference / (72 * 128 * 3), visiblePixels });
          } finally { sample.close(); }
        }
        dev.renderer.resize(...size);
        const format = exportResult.format;
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(exportResult.blob);
        anchor.download = `creactors-${duration}s.${format}`;
        document.body.append(anchor);
        window.__EXPORT_DOWNLOAD__ = { anchor, url: anchor.href };
        return {
          duration, format, codec: await track.getCodec(),
          width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
          actualDuration: await input.computeDuration(), frames: count, finalTimestamp, keyframes,
          comparisons, bytes: exportResult.blob.size, elapsedMs: elapsed,
          previewSize: dev.renderer.getSize(), memory: performance.memory?.usedJSHeapSize ?? null,
        };
      } finally { input.dispose(); await dev.renderer.prepare(originalSpec); }
    }, { duration, preferredHeight: process.env.CREACTORS_EXPORT_720 === '1' ? 1280 : 1920 });
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => window.__EXPORT_DOWNLOAD__.anchor.click());
    const download = await downloadEvent;
    const filename = `creactors-${duration}s-${metrics.height}p.${metrics.format}`;
    await download.saveAs(new URL(filename, directory).pathname);
    await page.evaluate(() => {
      window.__EXPORT_DOWNLOAD__.anchor.remove();
      URL.revokeObjectURL(window.__EXPORT_DOWNLOAD__.url);
      delete window.__EXPORT_DOWNLOAD__;
    });
    assert.equal(metrics.width / metrics.height, 9 / 16);
    assert.equal(metrics.frames, Math.ceil(duration * 30));
    assert.ok(Math.abs(metrics.actualDuration - Math.ceil(duration * 30) / 30) < 0.001);
    assert.deepEqual(metrics.previewSize, [540, 960]);
    assert.ok(metrics.comparisons.every(item => item.meanRgbDifference < 12), 'Decoded frames must match the rendered scene.');
    assert.ok(metrics.comparisons[1].visiblePixels > 80, 'The encoded film must contain typography.');
    results.push(metrics);
    console.log(JSON.stringify(metrics));
  }
  const cancellation = await page.evaluate(async () => {
    const { VideoExporter } = await import('/src/export/video-exporter.ts');
    const dev = window.__CREACTORS_DEV__;
    dev.seek(2.7);
    const controller = new AbortController();
    let progress = 0;
    let reason = null;
    try {
      await new VideoExporter().export(dev.renderer, dev.spec, {
        signal: controller.signal,
        onProgress: value => { progress = value; if (value > 0.03) controller.abort(); },
      });
    } catch (error) { reason = error.name; }
    return { reason, progress, size: dev.renderer.getSize(), restoredTime: dev.renderer.lastTime };
  });
  assert.equal(cancellation.reason, 'AbortError');
  assert.ok(cancellation.progress > 0 && cancellation.progress < 1);
  assert.deepEqual(cancellation.size, [540, 960]);
  assert.equal(cancellation.restoredTime, 2.7);
  console.log(JSON.stringify({ cancellation }));
  assert.deepEqual(errors, []);
  await writeFile(new URL('smoke-results.json', directory), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
