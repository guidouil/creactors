import './style.css';
import './app/touch';
import { mountShell } from './app/shell';
import { browserLocale, strings } from './app/i18n';
import { GenerationHistory } from './app/generation-history';
import { ExamplePicker } from './app/examples';
import { FUTURE_POSTER_TIME, futureDemo } from './demos/future';
import { GlyphCoverageError, loadDisplayFont, validateGlyphs } from './typography/fonts';
import { measureGroups } from './typography/measure';
import { TextDirector, type InputLanguage, type TextAnalysis } from './text/director';
import { MotionDirector, TooLongTextError, nextRemixSeed, sceneSignature, stableSeed } from './direction/director';
import { SceneRenderer } from './scene/renderer';
import { evaluateScene } from './scene/evaluator';
import type { SceneSpec } from './scene/types';
import { VideoExporter, ExportCapabilityError, ExportResourceError, AudioExportCapabilityError, isExportAvailable } from './export/video-exporter';
import { videoFilename } from './export/filename';
import { chooseTheme, resolveTheme, type ColorScheme } from './themes';
import { AudioPlayer, AudioImportError, MAX_AUDIO_DURATION, MAX_AUDIO_FILE_BYTES } from './audio/player';
import type { AudioTrack } from './audio/types';
import { getBuiltinAudio, isBuiltinAudioId, type BuiltinAudioId } from './audio/choices';
import { loadBuiltinAudio } from './audio/recordings';
import { importImage, ImageImportError, MAX_IMAGE_FILE_BYTES } from './image/importer';
import { MAX_IMAGE_COUNT, type ImageAsset } from './image/types';
import { downloadGiphyGif, GiphyError } from './image/giphy';
import { withFinalImages, FinalImageDurationError } from './scene/final-image';

const systemAppearance = matchMedia('(prefers-color-scheme: dark)');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const readColorScheme = (): ColorScheme => systemAppearance.matches ? 'dark' : 'light';
let colorScheme = readColorScheme();
const initialTheme = resolveTheme(futureDemo.themeId, colorScheme);
const initialLocale = browserLocale();
const examplePicker = new ExamplePicker();
const initialExample = examplePicker.next(initialLocale);
const shell = mountShell(document.querySelector<HTMLElement>('#app')!, {
  quote: initialExample, previewText: initialExample,
  locale: initialLocale, themeId: initialTheme.id, automaticTheme: true,
});
const generationHistory = new GenerationHistory();
const audioPlayer = new AudioPlayer();
let audioTrack: AudioTrack | null = null;
let audioName = '';
let audioPreset: BuiltinAudioId | null = null;
let renderer!: SceneRenderer;
let baseSpec: SceneSpec = { ...futureDemo, themeId: initialTheme.id };
let spec: SceneSpec = baseSpec;
let imageAssets: ImageAsset[] = [];
let analysis: TextAnalysis | null = null;
let themeId = spec.themeId;
let selectedThemeFamily: string | null = null;
const recentThemeIds: string[] = [themeId];
let current = 0;
let playing = false;
let playbackStarting = false;
let playbackGeneration = 0;
let seekPlayback: { generation: number; resume: boolean } | null = null;
let epoch = 0;
let animation = 0;
let lastPreviewFrame = -Infinity;
let started = false;
// The welcome film uses the same absolute timeline, without creating a film or
// starting audio. Once editing begins, only an explicit CREATE can play again.
let startupPreviewAllowed = true;
let renderingFailed = false;
let busy = false;
let booting = true;
let exportAbort: AbortController | null = null;
let completedUrl: string | null = null;
let exportHeight: 1920 | 1280 = 1920;
let message: ((copy: ReturnType<typeof strings>) => string) | null = null;

function showMessage(next: typeof message) {
  message = next;
  shell.setMessage(next?.(strings(shell.getLocale())) ?? null);
}

function releaseDownload() {
  if (completedUrl) URL.revokeObjectURL(completedUrl);
  completedUrl = null;
}

function rememberTheme(id: string) {
  recentThemeIds.push(id);
  recentThemeIds.splice(0, Math.max(0, recentThemeIds.length - 2));
}

function syncTheme() {
  shell.setTheme(themeId, selectedThemeFamily === null);
  document.documentElement.dataset.colorScheme = colorScheme;
  const background = getComputedStyle(document.documentElement).backgroundColor;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', background);
}

function applyTheme(nextId: string) {
  themeId = nextId;
  baseSpec = { ...baseSpec, themeId };
  spec = { ...spec, themeId };
  renderer?.setTheme(themeId);
  syncTheme();
  // A queued OS change can run immediately after the download click. Keep
  // that Blob URL alive until another job/page exit so Safari can consume it.
}

function followSystemAppearance() {
  // Keep the prepared scene frozen for every frame of a generation/export.
  // The latest OS preference is applied when that operation has finished.
  if (busy || booting || renderingFailed) return;
  const next = readColorScheme();
  if (next === colorScheme) return;
  colorScheme = next;
  applyTheme(resolveTheme(themeId, colorScheme).id);
}

syncTheme();
systemAppearance.addEventListener('change', followSystemAppearance);

function failRenderer(error: unknown) {
  renderingFailed = true;
  playing = false;
  playbackStarting = false;
  playbackGeneration++;
  seekPlayback = null;
  audioPlayer.pause();
  cancelAnimationFrame(animation);
  exportAbort?.abort();
  shell.setState('error');
  showMessage(copy => copy.renderError);
  console.error('CREACTORS rendering:', error);
}

function draw(time: number) {
  current = Math.max(0, Math.min(spec.duration, time));
  renderer.renderFrame(current);
  shell.setProgress(current / spec.duration);
}

function pause(preserveStartupPreview = false) {
  seekPlayback = null;
  if (!preserveStartupPreview) startupPreviewAllowed = false;
  if (playing && !playbackStarting) draw(playbackTime(performance.now()));
  playing = false;
  playbackStarting = false;
  playbackGeneration++;
  audioPlayer.pause();
  cancelAnimationFrame(animation);
  if (!busy) shell.setState(renderingFailed ? 'error' : !started ? 'idle' : current >= spec.duration ? 'ended' : 'paused');
}

function startSeeking() {
  if (busy || renderingFailed || !started || seekPlayback) return;
  const resume = playing;
  pause();
  seekPlayback = { generation: playbackGeneration, resume };
}

function seekTo(progress: number) {
  if (busy || renderingFailed || !started || !Number.isFinite(progress)) return;
  startSeeking();
  draw(Math.max(0, Math.min(1, progress)) * spec.duration);
  shell.setState(current >= spec.duration ? 'ended' : 'paused');
}

function finishSeeking(cancelled = false) {
  const pending = seekPlayback;
  seekPlayback = null;
  if (!cancelled && pending?.resume && pending.generation === playbackGeneration && !busy && !renderingFailed && !document.hidden) void play();
}

function playbackTime(now: number): number {
  return Math.max(0, (now - epoch) / 1000) % spec.duration;
}

function tick(now: number) {
  if (!playing) return;
  // Preview work is capped independently of display refresh rate. Export still
  // evaluates every exact 30 fps timestamp, using the same absolute-time state.
  if (now - lastPreviewFrame >= 1000 / 30 - 0.5) {
    draw(playbackTime(now));
    if (started) audioPlayer.synchronize(current, spec.duration);
    lastPreviewFrame = now;
  }
  animation = requestAnimationFrame(tick);
}

function startStartupPreview() {
  if (!startupPreviewAllowed || started || playing || busy || booting || renderingFailed || document.hidden || motionPreference.matches) return;
  cancelAnimationFrame(animation);
  playing = true;
  playbackStarting = false;
  playbackGeneration++;
  epoch = performance.now() - current * 1000;
  lastPreviewFrame = -Infinity;
  animation = requestAnimationFrame(tick);
}

async function play() {
  if (busy || renderingFailed || !started) return;
  seekPlayback = null;
  cancelAnimationFrame(animation);
  if (current >= spec.duration) draw(0);
  const time = current;
  const generation = ++playbackGeneration;
  playing = true;
  playbackStarting = true;
  epoch = performance.now() - time * 1000;
  shell.setState('playing');
  try { await audioPlayer.play(time, spec.duration); }
  catch { showMessage(copy => copy.audioPreviewUnavailable); }
  if (!playing || generation !== playbackGeneration || busy) return;
  playbackStarting = false;
  epoch = performance.now() - time * 1000;
  lastPreviewFrame = -Infinity;
  animation = requestAnimationFrame(tick);
}

function syncAudio() {
  audioPlayer.setTrack(audioTrack, spec.duration);
  shell.setAudio(audioTrack ? {
    name: audioPreset ? getBuiltinAudio(audioPreset).title : audioName,
    duration: audioTrack.buffer.duration, offset: audioTrack.offset, volume: audioTrack.volume,
    presetId: audioPreset ?? undefined,
  } : null);
}

function syncFilm(preserveEditing = false) {
  shell.setFilm({ text: spec.sourceText, language: spec.inputLanguage, duration: spec.duration, seed: spec.seed, themeId, secretFilm: spec.secretFilm }, preserveEditing);
}

/** Replace only the optional ending, retaining the existing text direction. */
async function applyImages(nextAssets: ImageAsset[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (started) {
    const nextSpec = withFinalImages(baseSpec, nextAssets);
    const previousSpec = spec;
    try { await renderer.prepare(nextSpec); signal?.throwIfAborted(); }
    catch (error) {
      // A failed texture preparation must leave the previous film usable.
      try { await renderer.prepare(previousSpec); draw(current); } catch (restoreError) { failRenderer(restoreError); }
      throw error;
    }
    spec = nextSpec;
    syncAudio();
    syncFilm(true);
    draw(Math.min(current, spec.duration));
    releaseDownload();
    exportHeight = 1920;
  }
  imageAssets = nextAssets;
  shell.setImages(imageAssets);
  if (started) window.dispatchEvent(new Event('creactors:scene'));
}

function showImageError(error: unknown) {
  showMessage(copy => error instanceof FinalImageDurationError ? copy.imageDurationError
    : error instanceof ImageImportError && error.kind === 'size' ? copy.imageImportSize(MAX_IMAGE_FILE_BYTES / 1024 / 1024)
    : error instanceof ImageImportError && error.kind === 'dimensions' ? copy.imageDimensionsError
    : error instanceof ImageImportError && error.kind === 'animation' ? copy.imageAnimationError
    : copy.imageDecodeError);
}

async function boot() {
  renderer = new SceneRenderer(shell.canvas);
  const initialSpecification = loadDisplayFont().then(() => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const initialAnalysis = TextDirector.analyze(initialExample, 'auto');
    const nextTheme = chooseTheme(seed, colorScheme);
    baseSpec = MotionDirector.direct(initialAnalysis, measureGroups(initialAnalysis), nextTheme.id, seed);
    spec = baseSpec;
    analysis = initialAnalysis;
    themeId = spec.themeId;
    rememberTheme(themeId);
    shell.setPreview({ text: spec.sourceText, language: spec.inputLanguage, duration: spec.duration, seed: spec.seed, themeId });
    syncTheme();
  });
  shell.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    failRenderer(new Error('WebGL context lost.'));
  });
  shell.canvas.addEventListener('webglcontextrestored', () => {
    initialSpecification.then(() => renderer.prepare(spec)).then(() => {
      renderingFailed = false;
      if (!busy) {
        draw(current);
        shell.setState(started ? 'paused' : 'idle');
      }
      followSystemAppearance();
      showMessage(null);
      startStartupPreview();
    }).catch(failRenderer);
  });
  await initialSpecification;
  await renderer.prepare(spec);
  booting = false;
  if (!renderingFailed) draw(motionPreference.matches ? spec.posterTime ?? 0 : 0);
  followSystemAppearance();
  startStartupPreview();
  shell.setExportAvailable(isExportAvailable());
}

const ready = boot();
ready.catch(failRenderer);

async function generate(text: string, language: InputLanguage, seed = stableSeed(text), previousSignature?: string | readonly string[], themeMode: 'seeded' | 'vary' | 'preserve' = 'seeded'): Promise<void> {
  if (busy) return;
  pause();
  busy = true;
  shell.setState('preparing');
  showMessage(null);
  try {
    await ready;
    if (renderingFailed) throw new Error('Renderer unavailable.');
    if (!text.trim()) { showMessage(copy => copy.inputEmpty); shell.setState('error'); return; }
    validateGlyphs(text);
    const nextAnalysis = TextDirector.analyze(text, language);
    const nextBase = MotionDirector.direct(nextAnalysis, measureGroups(nextAnalysis), themeId, seed, previousSignature);
    const nextTheme = themeMode === 'preserve'
      ? resolveTheme(themeId, colorScheme)
      : selectedThemeFamily === null
        ? chooseTheme(nextBase.seed, colorScheme, themeMode === 'vary' ? recentThemeIds : [])
        : resolveTheme(selectedThemeFamily, colorScheme);
    nextBase.themeId = nextTheme.id;
    const nextSpec = withFinalImages(nextBase, imageAssets);
    await renderer.prepare(nextSpec);
    baseSpec = nextBase;
    spec = nextSpec;
    themeId = spec.themeId;
    if (themeMode !== 'preserve') rememberTheme(themeId);
    syncTheme();
    generationHistory.remember(text, spec.seed, sceneSignature(spec));
    analysis = nextAnalysis;
    started = true;
    syncAudio();
    releaseDownload();
    exportHeight = 1920;
    syncFilm();
    draw(0);
    busy = false;
    followSystemAppearance();
    if (motionPreference.matches) {
      draw(spec.posterTime ?? FUTURE_POSTER_TIME);
      shell.setState('paused');
    } else play();
    window.dispatchEvent(new Event('creactors:scene'));
  } catch (error) {
    shell.setState('error');
    if (error instanceof GlyphCoverageError) {
      showMessage(copy => error.kind === 'emoji' ? copy.unsupportedEmoji(error.characters.join(' ')) : copy.unsupportedCharacters(error.characters.join(' ')));
    } else if (error instanceof TooLongTextError) showMessage(copy => copy.inputTooLong);
    else if (error instanceof FinalImageDurationError) showMessage(copy => copy.imageDurationError);
    else { showMessage(copy => renderingFailed ? copy.renderError : copy.generationError); console.error('CREACTORS generation:', error); }
  } finally { busy = false; followSystemAppearance(); }
}

shell.onExample(() => {
  if (busy) return;
  pause();
  shell.setExampleText(examplePicker.next(shell.getLocale()));
  showMessage(null);
});
shell.onCreate(() => {
  const input = shell.getInput();
  if (audioTrack) void audioPlayer.unlock().catch(() => {});
  void generate(input.text, 'auto', generationHistory.nextSeed(input.text, spec.seed), generationHistory.signatures(input.text), 'vary');
});
shell.onRemix(() => {
  if (!started || !analysis) return;
  if (audioTrack) void audioPlayer.unlock().catch(() => {});
  void generate(spec.sourceText, 'auto', nextRemixSeed(spec.sourceText, spec.seed), generationHistory.signatures(spec.sourceText), 'preserve');
});
shell.onTogglePlayback(() => playing ? pause() : play());
shell.onSeekStart(startSeeking);
shell.onSeek(seekTo);
shell.onSeekEnd(finishSeeking);
shell.onReplay(() => { if (busy) return; pause(); draw(0); play(); });
shell.onEdit(() => pause());
shell.onThemeChange(next => {
  if (busy) return;
  selectedThemeFamily = next;
  const theme = next === null
    ? chooseTheme(crypto.getRandomValues(new Uint32Array(1))[0]!, colorScheme, recentThemeIds)
    : resolveTheme(next, colorScheme);
  applyTheme(theme.id);
  rememberTheme(theme.id);
});
shell.onLocaleChange(() => {
  shell.setMessage(message?.(strings(shell.getLocale())) ?? null);
  if (audioPreset && audioTrack) shell.setAudio({
    name: getBuiltinAudio(audioPreset).title,
    duration: audioTrack.buffer.duration, offset: audioTrack.offset, volume: audioTrack.volume, presetId: audioPreset,
  });
});

shell.onGiphySelect(async (result, signal) => {
  if (busy || imageAssets.length >= MAX_IMAGE_COUNT) throw new GiphyError('download');
  if (started) pause();
  busy = true;
  shell.setImageLoading(true);
  showMessage(null);
  try {
    const file = await downloadGiphyGif(result, signal);
    signal.throwIfAborted();
    const asset = await importImage(file);
    signal.throwIfAborted();
    if (result.title.trim()) asset.name = result.title;
    asset.attribution = {
      provider: 'giphy', id: result.id, pageUrl: result.pageUrl,
      creatorName: result.creatorName, creatorUrl: result.creatorUrl,
    };
    await applyImages([...imageAssets, asset], signal);
  } finally {
    busy = false;
    shell.setImageLoading(false);
    followSystemAppearance();
    startStartupPreview();
  }
});

shell.onImageImport(async files => {
  if (busy || files.length === 0) return;
  if (imageAssets.length + files.length > MAX_IMAGE_COUNT) {
    showMessage(copy => copy.imageLimitError);
    return;
  }
  if (started) pause();
  busy = true;
  shell.setImageLoading(true);
  showMessage(null);
  try {
    const added: ImageAsset[] = [];
    // Bound decoding memory: never decode five full-size photographs together.
    for (const file of files) added.push(await importImage(file));
    await applyImages([...imageAssets, ...added]);
  } catch (error) { showImageError(error); }
  finally {
    busy = false;
    shell.setImageLoading(false);
    followSystemAppearance();
    startStartupPreview();
  }
});

shell.onImageRemove(async index => {
  if (busy || !imageAssets[index]) return;
  if (started) pause();
  busy = true;
  shell.setImageLoading(true);
  showMessage(null);
  try { await applyImages(imageAssets.filter((_, candidate) => candidate !== index)); }
  catch (error) { showImageError(error); }
  finally {
    busy = false;
    shell.setImageLoading(false);
    followSystemAppearance();
    startStartupPreview();
  }
});

shell.onAudioImport(async file => {
  if (busy) return;
  pause();
  busy = true;
  shell.setAudioLoading(true);
  showMessage(null);
  releaseDownload();
  void audioPlayer.unlock().catch(() => {});
  try {
    const imported = await audioPlayer.importFile(file);
    audioPreset = null;
    audioName = imported.name;
    audioTrack = { buffer: imported.buffer, offset: 0, volume: 0.7 };
    syncAudio();
  } catch (error) {
    showMessage(copy => error instanceof AudioImportError && error.kind === 'size' ? copy.audioImportSize(MAX_AUDIO_FILE_BYTES / 1024 / 1024)
      : error instanceof AudioImportError && error.kind === 'duration' ? copy.audioImportDuration(MAX_AUDIO_DURATION)
      : copy.audioDecodeError);
  } finally {
    busy = false;
    shell.setAudioLoading(false);
    followSystemAppearance();
  }
});

shell.onAudioPreset(async id => {
  if (busy || !isBuiltinAudioId(id)) return;
  const resume = playing;
  pause();
  busy = true;
  shell.setAudioLoading(true);
  showMessage(null);
  // Resume synchronously from this click, before decoding the embedded recording.
  void audioPlayer.unlock().catch(() => {});
  try {
    const buffer = await loadBuiltinAudio(id, audioPlayer);
    audioPreset = id;
    audioTrack = { buffer, offset: 0, volume: 0.7 };
    syncAudio();
    releaseDownload();
  } catch { showMessage(copy => copy.audioPreviewUnavailable); }
  finally {
    busy = false;
    shell.setAudioLoading(false);
    followSystemAppearance();
  }
  if (resume) void play();
});

shell.onAudioRemove(() => {
  if (busy) return;
  const resume = playing;
  pause();
  audioTrack = null;
  audioPreset = null;
  audioName = '';
  syncAudio();
  showMessage(null);
  if (resume) void play();
});

shell.onAudioChange(settings => {
  if (busy || !audioTrack) return;
  const resume = playing;
  pause();
  audioTrack = { ...audioTrack,
    offset: Math.max(0, Math.min(audioTrack.buffer.duration - 0.01, settings.offset)),
    volume: Math.max(0, Math.min(1, settings.volume)),
  };
  syncAudio();
  if (resume) void play();
});

shell.onDownload(async () => {
  if (busy || !started || renderingFailed) return;
  pause();
  releaseDownload();
  busy = true;
  exportAbort = new AbortController();
  shell.setState('exporting');
  shell.setExportProgress({});
  showMessage(null);
  try {
    let profileDetails = {};
    const result = await new VideoExporter().export(renderer, spec, {
      signal: exportAbort.signal,
      preferredHeight: exportHeight,
      audio: audioTrack ? { ...audioTrack } : undefined,
      onProfile(profile) {
        profileDetails = { format: profile.format, width: profile.width, height: profile.height };
        shell.setExportProgress(profileDetails);
      },
      onProgress(value) { shell.setExportProgress({ ...profileDetails, value }); },
    });
    releaseDownload();
    completedUrl = URL.createObjectURL(result.blob);
    const download = document.createElement('a');
    download.href = completedUrl;
    download.download = videoFilename(spec.sourceText, result.format);
    document.body.append(download);
    download.click();
    download.remove();
    showMessage(copy => `${copy.exportReady} ${copy.exportDetails(result.format, result.width, result.height)}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') showMessage(copy => copy.exportCancelled);
    else if (error instanceof AudioExportCapabilityError) showMessage(copy => copy.audioExportUnavailable);
    else if (error instanceof ExportCapabilityError) {
      shell.setExportAvailable(false);
      showMessage(copy => copy.exportUnavailable);
    } else if (error instanceof ExportResourceError && error.retryAt720p) {
      exportHeight = 1280;
      showMessage(copy => copy.exportRetry720);
    } else { showMessage(copy => copy.exportError); console.error('CREACTORS export:', error); }
  } finally {
    busy = false;
    exportAbort = null;
    shell.setExportProgress(null);
    shell.setState(renderingFailed ? 'error' : 'paused');
    followSystemAppearance();
    if (!renderingFailed) draw(current);
  }
});
shell.onCancelExport(() => exportAbort?.abort());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (playing || seekPlayback)) pause(!started);
  else if (!document.hidden) startStartupPreview();
});
motionPreference.addEventListener('change', () => {
  if (started || booting || renderingFailed) return;
  if (motionPreference.matches) {
    pause(true);
    draw(spec.posterTime ?? 0);
  } else startStartupPreview();
});
window.addEventListener('pagehide', () => {
  if (playing || seekPlayback) pause(!started);
  cancelAnimationFrame(animation);
  audioPlayer.pause();
  exportAbort?.abort();
  releaseDownload();
});

// The inspection interface and imports are stripped from the portable build.
if (import.meta.env.DEV) {
  const dev = {
    ready,
    get spec() { return spec; },
    get analysis() { return analysis; },
    get audio() { return audioTrack; },
    async generate(text: string, seed = stableSeed(text), language: InputLanguage = 'auto') {
      await generate(text, language, seed);
      pause();
      return spec;
    },
    seek(time: number) { if (busy) return; started = true; pause(); draw(time); shell.setState(current >= spec.duration ? 'ended' : 'paused'); },
    state() { return evaluateScene(spec, current); },
    bounds() { return renderer.projectedBounds(); },
    metrics() { return { frameTime: renderer.frameTime, calls: renderer.renderer.info.render.calls, triangles: renderer.renderer.info.render.triangles }; },
    async capture(time: number) {
      await ready;
      const size = renderer.getSize();
      pause();
      try { renderer.resize(1080, 1920); draw(time); return shell.canvas.toDataURL('image/png'); }
      finally { renderer.resize(...size); }
    },
    get renderer() { return renderer; },
  };
  Object.assign(window, { __CREACTORS_DEV__: dev });
  if (new URLSearchParams(location.search).has('inspect')) {
    void import('./dev/inspector').then(module => module.mountInspector(dev)).catch(console.error);
  }
}
