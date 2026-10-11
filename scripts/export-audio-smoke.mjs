import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Native codec proof with an original sine signal; no remote media or fixture music.
const url = process.argv[2] || 'http://127.0.0.1:5174/';
const format = process.argv[3] || 'mp4';
const duration = Number(process.argv[4] || 12);
const channelCount = process.env.CREACTORS_AUDIO_CHANNELS === '1' ? 1 : 2;
const suffix = channelCount === 1 ? '-mono' : '';
const directory = new URL('../artifacts/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (format === 'webm') await page.addInitScript(() => {
    const nativeSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = config => config.codec.startsWith('avc1.')
      ? Promise.resolve({ supported: false, config }) : nativeSupport(config);
  });
  await page.goto(url);
  const report = await page.evaluate(async ({ duration, channelCount, suffix }) => {
    const dev = window.__CREACTORS_DEV__;
    await dev.ready;
    const [{ VideoExporter }, media] = await Promise.all([
      import('/src/export/video-exporter.ts'), import('/node_modules/mediabunny/dist/modules/src/index.js'),
    ]);
    dev.seek(1.2);
    const beforeTime = dev.renderer.lastTime;
    const beforeSize = dev.renderer.getSize();
    const context = new AudioContext({ sampleRate: 48000 });
    const buffer = context.createBuffer(channelCount, 4 * 48000, 48000);
    // Two distinguishable channels prove stereo preservation and selected offset.
    for (let channel = 0; channel < channelCount; channel++) {
      const samples = buffer.getChannelData(channel);
      const frequency = channel === 0 ? 440 : 660;
      for (let index = 0; index < samples.length; index++) samples[index] = 0.5 * Math.sin(2 * Math.PI * frequency * index / 48000);
    }
    await context.close();
    const spec = { ...dev.spec, duration };
    const started = performance.now();
    const result = await new VideoExporter().export(dev.renderer, spec, { audio: { buffer, offset: 1, volume: 0.6 } });
    const elapsedMs = performance.now() - started;
    const input = new media.Input({ source: new media.BlobSource(result.blob), formats: [media.MP4, media.WEBM] });
    try {
      const video = await input.getPrimaryVideoTrack();
      const audio = await input.getPrimaryAudioTrack();
      if (!video || !audio) throw new Error('The exported container does not contain both tracks.');
      let videoFrames = 0;
      for await (const _packet of new media.EncodedPacketSink(video).packets()) videoFrames++;
      let packets = 0, audioEnd = 0, audioStart = Infinity;
      for await (const packet of new media.EncodedPacketSink(audio).packets()) {
        packets++;
        audioStart = Math.min(audioStart, packet.timestamp);
        audioEnd = Math.max(audioEnd, packet.timestamp + packet.duration);
      }
      const decoded = { voicedSquared: Array(channelCount).fill(0), voicedFrames: 0, loopSquared: Array(channelCount).fill(0), loopFrames: 0, lastSquared: Array(channelCount).fill(0), lastFrames: 0, sampleFrames: 0, end: 0 };
      for await (const sample of new media.AudioSampleSink(audio).samples()) {
        try {
          const channels = Array.from({ length: channelCount }, () => new Float32Array(sample.numberOfFrames));
          channels.forEach((data, planeIndex) => sample.copyTo(data, { planeIndex, format: 'f32-planar' }));
          for (let frame = 0; frame < sample.numberOfFrames; frame++) {
            const time = sample.timestamp + frame / sample.sampleRate;
            if (time >= 0.2 && time < Math.min(2, duration - 0.15)) {
              decoded.voicedFrames++;
              for (let channel = 0; channel < channelCount; channel++) decoded.voicedSquared[channel] += channels[channel][frame] ** 2;
            }
            if (time >= 3.15 && time < duration - 0.1) {
              decoded.loopFrames++;
              for (let channel = 0; channel < channelCount; channel++) decoded.loopSquared[channel] += channels[channel][frame] ** 2;
            }
            if (time >= duration - 1.2 && time < duration - 0.2) {
              decoded.lastFrames++;
              for (let channel = 0; channel < channelCount; channel++) decoded.lastSquared[channel] += channels[channel][frame] ** 2;
            }
          }
          decoded.sampleFrames += sample.numberOfFrames;
          decoded.end = Math.max(decoded.end, sample.timestamp + sample.duration);
        } finally { sample.close(); }
      }
      const blobUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `creactors-audio-${duration}s${suffix}.${result.format}`;
      document.body.append(anchor);
      window.__AUDIO_SMOKE_DOWNLOAD__ = { anchor, blobUrl };
      return {
        format: result.format, audioCodec: result.audioCodec,
        videoCodec: await video.getCodecParameterString(), audioCodecString: await audio.getCodecParameterString(),
        sampleRate: await audio.getSampleRate(), channels: await audio.getNumberOfChannels(),
        width: await video.getDisplayWidth(), height: await video.getDisplayHeight(),
        duration: await input.computeDuration(), expectedDuration: Math.ceil(duration * 30) / 30,
        videoFrames, expectedFrames: Math.ceil(duration * 30), packets, audioStart, audioEnd,
        voicedRms: decoded.voicedSquared.map(value => Math.sqrt(value / decoded.voicedFrames)),
        loopRms: decoded.loopSquared.map(value => Math.sqrt(value / Math.max(1, decoded.loopFrames))),
        lastRms: decoded.lastSquared.map(value => Math.sqrt(value / Math.max(1, decoded.lastFrames))),
        decodedFrames: decoded.sampleFrames, decodedAudioEnd: decoded.end, bytes: result.blob.size, elapsedMs,
        beforeTime, afterTime: dev.renderer.lastTime, beforeSize, afterSize: dev.renderer.getSize(),
      };
    } finally { input.dispose(); }
  }, { duration, channelCount, suffix });
  await writeFile(new URL(`report-${duration}s-${format}${suffix}.json`, directory), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.format, format);
  assert.equal(report.videoFrames, report.expectedFrames);
  assert.equal(report.channels, channelCount);
  assert.equal(report.sampleRate, 48000);
  assert.ok(Math.abs(report.duration - report.expectedDuration) < 0.0011, `Container length ${report.duration}`);
  // WebM demuxing leaves its final packet's duration unspecified. Check actual
  // decoded coverage within one native codec packet; the container stays exact.
  assert.ok(report.decodedAudioEnd >= report.expectedDuration - 0.021
    && report.decodedAudioEnd <= report.expectedDuration + 0.022, `Decoded audio length ${report.decodedAudioEnd}`);
  assert.ok(report.voicedRms.every(value => Math.abs(value - 0.3 / Math.sqrt(2)) < 0.015), `Voiced RMS ${report.voicedRms}`);
  if (duration > 4) assert.ok(report.loopRms.every(value => Math.abs(value - 0.3 / Math.sqrt(2)) < 0.025), `Repeated soundtrack RMS ${report.loopRms}`);
  assert.ok(report.lastRms.every(value => Math.abs(value - 0.3 / Math.sqrt(2)) < 0.025), `Audio disappeared near the end ${report.lastRms}`);
  assert.deepEqual(report.afterSize, report.beforeSize);
  assert.equal(report.afterTime, report.beforeTime);
  assert.deepEqual(errors, []);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => window.__AUDIO_SMOKE_DOWNLOAD__.anchor.click());
  const download = await downloadPromise;
  await download.saveAs(new URL(`creactors-audio-${duration}s${suffix}.${format}`, directory).pathname);
} finally { await browser.close(); }
