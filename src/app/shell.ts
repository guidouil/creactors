import { icon } from './icons';
import { strings, type Locale } from './i18n';
import { getTheme, getThemeFamilyId, themeFamilies } from '../themes';
import { MAX_IMAGE_COUNT } from '../image/types';
import type { ImageAsset, MediaPlacement } from '../image/types';
import type { GiphyResult } from '../image/giphy';
import { createGiphyPicker } from './giphy-picker';
import { createFontPicker } from './font-picker';
import { DEFAULT_FONT_ID, getDisplayFont, loadDisplayFont } from '../typography/fonts';
import { graphemes } from '../text/graphemes';
import { builtinAudioTracks, getBuiltinAudio, isBuiltinAudioId } from '../audio/choices';
import { mountEasterEggs } from './easter-eggs';
import { findSecretFilm, type SecretFilmId } from '../direction/secrets';
import { filmAspect, type FilmFormat } from '../scene/format';

export type ShellState = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'exporting' | 'error';

export interface ShellOptions {
  quote: string;
  previewText?: string;
  locale: Locale;
  themeId?: string;
  automaticTheme?: boolean;
  fontId?: string;
  format?: FilmFormat;
}

export interface FilmDetails {
  text: string;
  language: Locale;
  duration: number;
  seed: number;
  themeId: string;
  secretFilm?: SecretFilmId;
  fontId?: string;
}

export interface ExportProgress {
  value?: number;
  format?: string;
  width?: number;
  height?: number;
}

export interface AudioSettings {
  offset: number;
  volume: number;
}

export interface AudioDetails extends AudioSettings {
  name: string;
  duration: number;
  presetId?: string;
}

export interface ImageDetails {
  name: string;
  source: string;
  video?: ImageAsset['video'];
  attribution?: ImageAsset['attribution'];
  animation?: {
    duration: number;
    frames: readonly { source: string; end: number }[];
  };
}

export interface Shell {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  getInput(): { text: string; fontId: string; format: FilmFormat };
  getFormat(): FilmFormat;
  onCreate(callback: () => void): void;
  onExample(callback: () => void): void;
  onTogglePlayback(callback: () => void): void;
  onReplay(callback: () => void): void;
  onSeekStart(callback: () => void): void;
  onSeek(callback: (progress: number) => void): void;
  onSeekEnd(callback: (cancelled?: boolean) => void): void;
  onRemix(callback: () => void): void;
  onDownload(callback: () => void): void;
  onGifDownload(callback: () => void): void;
  onCancelExport(callback: () => void): void;
  onEdit(callback: () => void): void;
  onThemeChange(callback: (familyId: string | null) => void): void;
  onFontChange(callback: (fontId: string, applyToFilm: boolean) => void | Promise<void>): void;
  onFormatChange(callback: (format: FilmFormat) => void | Promise<void>): void;
  onImageImport(callback: (files: File[]) => void): void;
  onGiphySelect(callback: (result: GiphyResult, signal: AbortSignal) => Promise<void>): void;
  onImageRemove(callback: (index: number) => void): void;
  onMediaPlacementChange(callback: (placement: MediaPlacement) => void): void;
  onAudioImport(callback: (file: File) => void): void;
  onAudioRemove(callback: () => void): void;
  onAudioPreset(callback: (presetId: string) => void): void;
  onAudioChange(callback: (settings: AudioSettings) => void): void;
  onLocaleChange(callback: (locale: Locale) => void): void;
  setPreview(film: FilmDetails): void;
  setFilm(film: FilmDetails, preserveEditing?: boolean): void;
  setExampleText(text: string): void;
  setTheme(themeId: string, automatic: boolean): void;
  setFont(fontId: string): void;
  setFormat(format: FilmFormat): void;
  setImages(details: ImageDetails[]): void;
  setMediaPlacement(placement: MediaPlacement): void;
  setImageLoading(loading: boolean): void;
  setAudio(details: AudioDetails | null): void;
  setAudioLoading(loading: boolean): void;
  setState(state: ShellState, preserveEditing?: boolean): void;
  setEditing(editing: boolean): void;
  setProgress(progress: number): void;
  setExportProgress(progress: ExportProgress | null): void;
  setExportAvailable(available: boolean): void;
  setGifExportAvailable(available: boolean): void;
  setMessage(message: string | null): void;
  getLocale(): Locale;
}

export function mountShell(host: HTMLElement, options: ShellOptions): Shell {
  let locale = options.locale;
  let state: ShellState = 'idle';
  let progress = 0;
  let duration = 12;
  let editing = true;
  let hasFilm = false;
  let exportAvailable = false;
  let gifExportAvailable = true;
  let exportProgress: ExportProgress | null = null;
  let themeId = options.themeId ?? 'califormandy-sunset';
  let automaticTheme = options.automaticTheme ?? true;
  let fontId = options.fontId ?? DEFAULT_FONT_ID;
  let filmFontId = fontId;
  let format = options.format ?? 'vertical';
  let fontPickerAppliesToFilm = false;
  let imageDetails: ImageDetails[] = [];
  let imageLoading = false;
  let mediaPlacement: MediaPlacement = 'after';
  let audioDetails: AudioDetails | null = null;
  let audioLoading = false;
  let audioOpen = false;
  let activeSecret: ReturnType<typeof findSecretFilm> = null;
  let createCallback: () => void = () => undefined;
  let exampleCallback: () => void = () => undefined;
  let toggleCallback: () => void = () => undefined;
  let replayCallback: () => void = () => undefined;
  let seekStartCallback: () => void = () => undefined;
  let seekCallback: (progress: number) => void = () => undefined;
  let seekEndCallback: (cancelled?: boolean) => void = () => undefined;
  let remixCallback: () => void = () => undefined;
  let downloadCallback: () => void = () => undefined;
  let gifDownloadCallback: () => void = () => undefined;
  let cancelExportCallback: () => void = () => undefined;
  let editCallback: () => void = () => undefined;
  let themeCallback: (familyId: string | null) => void = () => undefined;
  let fontCallback: (fontId: string, applyToFilm: boolean) => void | Promise<void> = () => undefined;
  let formatCallback: (format: FilmFormat) => void | Promise<void> = () => undefined;
  let imageImportCallback: (files: File[]) => void = () => undefined;
  let giphySelectCallback: (result: GiphyResult, signal: AbortSignal) => Promise<void> = async () => undefined;
  let imageRemoveCallback: (index: number) => void = () => undefined;
  let mediaPlacementCallback: (placement: MediaPlacement) => void = () => undefined;
  let audioImportCallback: (file: File) => void = () => undefined;
  let audioRemoveCallback: () => void = () => undefined;
  let audioPresetCallback: (presetId: string) => void = () => undefined;
  let audioChangeCallback: (settings: AudioSettings) => void = () => undefined;
  let localeCallback: (locale: Locale) => void = () => undefined;

  const placementControls = `<div class="image-placement" role="group" hidden>
    <button type="button" data-media-placement="before" aria-pressed="false"></button>
    <button type="button" data-media-placement="after" aria-pressed="true"></button>
  </div>`;
  host.innerHTML = `
    <div class="studio" data-state="idle" data-editing="true">
      <header class="masthead">
        <a class="brand" href="#" aria-label="CREACTORS">
          <span class="brand-mark" aria-hidden="true"><span></span></span>
          <span class="brand-name">CREACTORS</span>
        </a>
        <span class="tagline"></span>
        <div class="header-actions">
          <div class="locale-switch" role="group">
            <button type="button" data-locale="fr">FR</button>
            <span aria-hidden="true">/</span>
            <button type="button" data-locale="en">EN</button>
          </div>
          <button class="help-button icon-button" type="button" aria-haspopup="dialog" aria-controls="studio-help">${icon('help')}</button>
        </div>
      </header>
      <main class="workspace">
        <section class="quote-panel">
          <div class="quote-heading">
            <div class="eyebrow"><span class="eyebrow-line" aria-hidden="true"></span><span class="demo-label"></span></div>
            <button class="example-button icon-button" type="button">${icon('dice')}</button>
          </div>
          <textarea class="quote-input" spellcheck="false" rows="5"></textarea>
          <div class="input-controls">
            <button class="font-editor-button font-button" type="button"><span class="font-button-mark" aria-hidden="true">Aa</span><span class="font-button-name"></span></button>
            <button class="image-editor-button image-button icon-button" type="button">${icon('image')}</button>
          </div>
          <button class="create-button" type="button"><span class="create-label"></span>${icon('arrow')}</button>
          <input class="image-file" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.avif,.gif,.mp4,.m4v,.webm,.mov" multiple hidden>
          <div class="image-editor-source image-source-row image-gallery" hidden></div>
          <div class="image-editor-placement">${placementControls}</div>
          <div class="image-editor-attributions image-attributions" hidden></div>
        </section>
        <section class="film-panel">
          <div class="film-meta">
            <span class="film-index" aria-hidden="true">01</span>
            <div class="format-switch" role="group">
              <button type="button" data-film-format="vertical" aria-pressed="true"><span class="format-name"></span><span class="format-ratio" aria-hidden="true">9:16</span></button>
              <button type="button" data-film-format="square" aria-pressed="false"><span class="format-name"></span><span class="format-ratio" aria-hidden="true">1:1</span></button>
            </div>
            <span class="film-duration" aria-hidden="true">12 S</span>
          </div>
          <p class="film-secret" role="status" hidden></p>
          <div class="stage"><canvas width="540" height="960"></canvas><div class="stage-corner top-left" aria-hidden="true"></div><div class="stage-corner bottom-right" aria-hidden="true"></div></div>
          <p id="film-transcript" class="sr-only"></p>
          <div class="playback" hidden>
            <input class="progress-track" type="range" min="0" max="12" step="0.03333333333333333" value="0">
            <div class="playback-actions">
              <div class="transport">
                <button class="replay-button icon-button" type="button">${icon('replay')}</button>
                <button class="toggle-button icon-button" type="button">${icon('play')}</button>
              </div>
              <div class="film-actions">
                <button class="remix-button icon-button" type="button">${icon('remix')}</button>
                <button class="download-button icon-button" type="button">${icon('download')}</button>
                <button class="gif-download-button icon-button" type="button" aria-describedby="gif-download-hint"><span aria-hidden="true">GIF</span></button>
                <span id="gif-download-hint" class="sr-only"></span>
                <button class="edit-button icon-button" type="button">${icon('edit')}</button>
              </div>
            </div>
            <div class="film-options">
              <div class="film-settings-bar">
                <span class="timecode" aria-hidden="true">00:00 <span>/ 00:12</span></span>
                <div class="film-media-buttons">
                  <button class="font-film-button font-button icon-button" type="button"><span class="font-button-mark" aria-hidden="true">Aa</span></button>
                  <button class="image-film-button image-button icon-button" type="button">${icon('image')}</button>
                  <button class="audio-button icon-button" type="button" aria-expanded="false" aria-controls="film-audio">${icon('audio')}</button>
                </div>
              </div>
              <div class="image-film-source image-source-row image-gallery" hidden></div>
              <div class="image-film-placement">${placementControls}</div>
              <div class="image-film-attributions image-attributions" hidden></div>
              <div class="theme-switch" role="group">
                <button class="theme-auto icon-button" type="button" data-theme="auto">${icon('cycle')}</button>
                ${themeFamilies.map(family => `<button class="theme-swatch" type="button" data-theme="${family.id}" style="--swatch-dark:${family.swatch};--swatch-light:${family.lightSwatch}"><span></span></button>`).join('')}
              </div>
              <div id="film-audio" class="audio-panel" hidden>
                <input class="audio-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac" hidden>
                <div class="audio-presets" role="group">
                  ${builtinAudioTracks.map(track => `<button type="button" data-audio-preset="${track.id}"></button>`).join('')}
                </div>
                <div class="audio-source-row">
                  <button class="audio-import-button" type="button">${icon('audio')}<span class="audio-source-name"></span></button>
                  <button class="audio-credits-button" type="button" aria-haspopup="dialog" aria-controls="audio-credits"></button>
                  <button class="audio-remove-button icon-button" type="button" hidden>${icon('cancel')}</button>
                </div>
                <div class="audio-settings" hidden>
                  <label class="audio-range-row"><span class="audio-offset-label"></span><input class="audio-offset" type="range" min="0" max="0" step="0.1" value="0"><output class="audio-offset-value"></output></label>
                  <label class="audio-range-row"><span class="audio-volume-label"></span><input class="audio-volume" type="range" min="0" max="1" step="0.01" value="0.7"><output class="audio-volume-value"></output></label>
                </div>
              </div>
            </div>
          </div>
          <div class="export-progress" hidden>
            <div class="export-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
            <div class="export-progress-details"><p><span class="export-status"></span><span class="export-format"></span></p><button class="cancel-export-button icon-button" type="button">${icon('cancel')}</button></div>
          </div>
          <p class="message" role="status" hidden></p>
          <p class="state-announcement sr-only" aria-live="polite"></p>
        </section>
        <aside class="edition" aria-hidden="true"><span class="edition-line"></span><span class="edition-label">CREACTORS / 001</span><span class="sunset-stamp"><span></span></span></aside>
      </main>
      <footer class="studio-footer">
        <span class="footer-credit"></span>
        <a class="footer-source" href="https://github.com/guidouil/creactors" target="_blank" rel="noopener noreferrer"><span class="footer-source-label"></span>${icon('arrow')}</a>
        <span class="footer-index" aria-hidden="true">© CREACTORS</span>
      </footer>
      <dialog id="studio-help" class="help-dialog" aria-labelledby="help-title">
        <div class="help-heading"><h2 id="help-title"></h2><button class="help-close icon-button" type="button" autofocus>${icon('cancel')}</button></div>
        <ul class="help-list">
          <li class="help-feature">${icon('edit')}<div><h3 class="help-create-title"></h3><p class="help-create"></p></div></li>
          <li class="help-feature">${icon('remix')}<div><h3 class="help-remix-title"></h3><p class="help-remix"></p></div></li>
          <li class="help-feature"><span class="help-color-icon" aria-hidden="true"></span><div><h3 class="help-colors-title"></h3><p class="help-colors"></p></div></li>
          <li class="help-feature"><span class="help-font-icon" aria-hidden="true">Aa</span><div><h3 class="help-fonts-title"></h3><p class="help-fonts"></p></div></li>
          <li class="help-feature">${icon('audio')}<div><h3 class="help-audio-title"></h3><p class="help-audio"></p></div></li>
          <li class="help-feature">${icon('image')}<div><h3 class="help-photos-title"></h3><p class="help-photos"></p></div></li>
          <li class="help-feature">${icon('download')}<div><h3 class="help-download-title"></h3><p class="help-download"></p></div></li>
        </ul>
        <p class="help-local"></p>
      </dialog>
      <dialog id="audio-credits" class="audio-credits-dialog" aria-labelledby="audio-credits-title" aria-describedby="audio-credits-description">
        <div class="audio-credits-heading"><h2 id="audio-credits-title"></h2><button class="audio-credits-close icon-button" type="button" autofocus>${icon('cancel')}</button></div>
        <p id="audio-credits-description" class="audio-credits-description"></p>
        <div class="audio-credits-list"></div>
      </dialog>
    </div>`;

  const find = <T extends Element>(selector: string): T => {
    const element = host.querySelector<T>(selector);
    if (!element) throw new Error(`Missing shell element: ${selector}`);
    return element;
  };

  const studio = find<HTMLElement>('.studio');
  const canvas = find<HTMLCanvasElement>('canvas');
  const stage = find<HTMLElement>('.stage');
  const quote = find<HTMLTextAreaElement>('.quote-input');
  const quoteMeasure = document.createElement('canvas').getContext('2d');
  let quoteSizeFrame = 0;
  const create = find<HTMLButtonElement>('.create-button');
  const example = find<HTMLButtonElement>('.example-button');
  const playback = find<HTMLElement>('.playback');
  const toggle = find<HTMLButtonElement>('.toggle-button');
  const replay = find<HTMLButtonElement>('.replay-button');
  const remix = find<HTMLButtonElement>('.remix-button');
  const download = find<HTMLButtonElement>('.download-button');
  const gifDownload = find<HTMLButtonElement>('.gif-download-button');
  const edit = find<HTMLButtonElement>('.edit-button');
  const help = find<HTMLButtonElement>('.help-button');
  const helpDialog = find<HTMLDialogElement>('.help-dialog');
  const helpClose = find<HTMLButtonElement>('.help-close');
  let helpOpener: HTMLElement | null = null;
  const imageFile = find<HTMLInputElement>('.image-file');
  const audio = find<HTMLButtonElement>('.audio-button');
  const audioPanel = find<HTMLElement>('.audio-panel');
  const audioFile = find<HTMLInputElement>('.audio-file');
  const audioImport = find<HTMLButtonElement>('.audio-import-button');
  const audioRemove = find<HTMLButtonElement>('.audio-remove-button');
  const audioOffset = find<HTMLInputElement>('.audio-offset');
  const audioVolume = find<HTMLInputElement>('.audio-volume');
  const audioCredits = find<HTMLButtonElement>('.audio-credits-button');
  const audioCreditsDialog = find<HTMLDialogElement>('.audio-credits-dialog');
  const audioCreditsClose = find<HTMLButtonElement>('.audio-credits-close');
  const audioCreditEntries = builtinAudioTracks.map(track => {
    const entry = document.createElement('article');
    entry.className = 'audio-credit-entry';
    entry.dataset.audioCredit = track.id;
    const title = document.createElement('h3');
    title.textContent = track.title;
    const metadata = document.createElement('p');
    metadata.className = 'audio-credit-meta';
    if (track.artist) metadata.append(document.createTextNode(`${track.artist} · `));
    let provided: HTMLElement | null = null;
    if (track.licenseUrl) {
      const license = document.createElement('a');
      license.href = track.licenseUrl;
      license.textContent = track.license;
      license.target = '_blank';
      license.rel = 'noopener noreferrer';
      metadata.append(license);
    } else {
      provided = document.createElement('span');
      metadata.append(provided);
    }
    let source: HTMLAnchorElement | null = null;
    if (track.sourceUrl) {
      source = document.createElement('a');
      source.className = 'audio-credit-source';
      source.href = track.sourceUrl;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      metadata.append(document.createTextNode(' · '), source);
    }
    entry.append(title, metadata);
    let creditText: HTMLTextAreaElement | null = null;
    let copyButton: HTMLButtonElement | null = null;
    let status: HTMLElement | null = null;
    if (track.attributionRequired && track.credit) {
      creditText = document.createElement('textarea');
      creditText.className = 'audio-credit-text';
      creditText.value = track.credit;
      creditText.readOnly = true;
      creditText.rows = 5;
      creditText.spellcheck = false;
      copyButton = document.createElement('button');
      copyButton.className = 'audio-credit-copy';
      copyButton.type = 'button';
      copyButton.dataset.audioCreditCopy = track.id;
      status = document.createElement('p');
      status.className = 'audio-credit-status';
      status.setAttribute('role', 'status');
      const actions = document.createElement('div');
      actions.className = 'audio-credit-actions';
      actions.append(copyButton, status);
      entry.append(creditText, actions);
    }
    find<HTMLElement>('.audio-credits-list').append(entry);
    return { track, entry, provided, source, creditText, copyButton, status };
  });
  let creditCopyVersion = 0;
  let creditsOpener: HTMLElement | null = null;
  const cancelExport = find<HTMLButtonElement>('.cancel-export-button');
  const progressTrack = find<HTMLInputElement>('.progress-track');
  const timecode = find<HTMLElement>('.timecode');
  const message = find<HTMLParagraphElement>('.message');
  const exportPanel = find<HTMLElement>('.export-progress');
  const exportTrack = find<HTMLElement>('.export-progress-track');
  const exportFill = find<HTMLElement>('.export-progress-track > span');
  const transcript = find<HTMLParagraphElement>('#film-transcript');
  const localeButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-locale]')];
  const themeButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-theme]')];
  const audioPresetButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-audio-preset]')];
  const imageButtons = [...host.querySelectorAll<HTMLButtonElement>('.image-button')];
  const fontButtons = [...host.querySelectorAll<HTMLButtonElement>('.font-button')];
  const formatButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-film-format]')];
  const imageGalleries = [...host.querySelectorAll<HTMLElement>('.image-gallery')];
  const imageAttributions = [...host.querySelectorAll<HTMLElement>('.image-attributions')];
  const placementGroups = [...host.querySelectorAll<HTMLElement>('.image-placement')];
  const placementButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-media-placement]')];
  const giphyPicker = createGiphyPicker(studio, {
    getLocale: () => locale,
    onSelect: (result, signal) => giphySelectCallback(result, signal),
    onLocal: () => imageFile.click(),
  });
  for (const button of imageButtons) {
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'final-media-picker');
  }
  const fontPicker = createFontPicker(studio, {
    getLocale: () => locale,
    getSample: () => fontPickerAppliesToFilm ? transcript.textContent ?? quote.value : quote.value,
    async onChange(id) {
      await fontCallback(id, fontPickerAppliesToFilm);
      if (!fontPickerAppliesToFilm || !editing) setFont(id);
    },
  });
  for (const button of fontButtons) {
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'font-picker');
    button.addEventListener('click', () => {
      if (button.disabled) return;
      fontPickerAppliesToFilm = button.classList.contains('font-film-button');
      fontPicker.setFont(fontPickerAppliesToFilm ? filmFontId : fontId);
      fontPicker.open(button);
    });
  }

  function setFont(id: string) {
    const font = getDisplayFont(id);
    fontId = font.id;
    quote.style.fontFamily = `${JSON.stringify(font.family)}, sans-serif`;
    quote.style.fontWeight = String(font.weight);
    quote.style.fontStyle = font.style;
    find<HTMLElement>('.font-button-name').textContent = font.name;
    buttonLabel(find<HTMLButtonElement>('.font-editor-button'), strings(locale).fontCurrent(font.name));
    buttonLabel(find<HTMLButtonElement>('.font-film-button'), strings(locale).fontCurrent(getDisplayFont(filmFontId).name));
    fontPicker.setFont(id);
    scheduleQuoteFontSize();
    // The browser must use the loaded face rather than a fallback's advances.
    void loadDisplayFont(id).then(() => { if (fontId === id) scheduleQuoteFontSize(); }).catch(() => undefined);
  }

  function setFormat(next: FilmFormat) {
    format = next;
    studio.dataset.format = format;
    studio.style.setProperty('--film-aspect', String(filmAspect(format)));
    updateLabels();
  }

  function fitQuoteFontSize() {
    if (!quoteMeasure || quote.clientWidth === 0) return;
    // Recover the responsive CSS size every time, so shorter text, a narrower
    // font or a larger viewport can grow back after an earlier reduction.
    quote.style.removeProperty('font-size');
    const style = getComputedStyle(quote);
    const baseSize = parseFloat(style.fontSize);
    const width = quote.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 6;
    if (!(baseSize > 0) || !(width > 0)) return;
    const { capHeight, unitsPerEm } = getDisplayFont(fontId).metadata;
    const capRatio = capHeight / unitsPerEm;
    const normalizedSize = baseSize * (Number.isFinite(capRatio) && capRatio > 0 ? Math.min(1, 0.7 / capRatio) : 1);
    const spacing = (parseFloat(style.letterSpacing) || 0) / baseSize;
    quoteMeasure.font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
    let widestWord = 0;
    for (const word of (quote.value || quote.placeholder).trim().split(/\s+/u)) {
      const normalized = word.normalize('NFC');
      const metrics = quoteMeasure.measureText(normalized);
      const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
      const measured = Math.max(metrics.width, Number.isFinite(inkWidth) ? inkWidth : 0) / 100;
      widestWord = Math.max(widestWord, measured + spacing * Math.max(0, graphemes(normalized).length - 1));
    }
    // Keep long drafts scrollable vertically; fit words, not the whole quote.
    const size = Math.max(16, Math.min(normalizedSize, widestWord > 0 ? width / widestWord : normalizedSize));
    quote.style.fontSize = `${Math.floor(size * 100) / 100}px`;
  }

  function scheduleQuoteFontSize() {
    if (quoteSizeFrame) return;
    quoteSizeFrame = requestAnimationFrame(() => { quoteSizeFrame = 0; fitQuoteFontSize(); });
  }
  const quoteSizeObserver = new ResizeObserver(scheduleQuoteFontSize);
  quoteSizeObserver.observe(quote);
  window.addEventListener('resize', scheduleQuoteFontSize);
  document.fonts.addEventListener('loadingdone', scheduleQuoteFontSize);

  function updateMessageSpace() {
    const height = message.hidden ? 0 : message.getBoundingClientRect().height + parseFloat(getComputedStyle(message).marginTop);
    studio.style.setProperty('--message-space', `${Math.ceil(Number.isFinite(height) ? height : 0)}px`);
  }
  const messageObserver = new ResizeObserver(updateMessageSpace);
  messageObserver.observe(message);

  function setExampleText(text: string) {
    if (imageLoading || audioLoading || state === 'preparing' || state === 'exporting') return;
    quote.value = text;
    quote.scrollTop = 0;
    editing = true;
    updateState();
    quote.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const easterEggs = mountEasterEggs(host, {
    getLocale: () => locale,
    isBlocked: () => imageLoading || audioLoading || state === 'preparing' || state === 'exporting',
    onSecretExample(text) {
      setExampleText(text);
      // Let the dialog restore its opener first, then bring the loaded draft
      // back into view even when the collection was opened from the footer.
      requestAnimationFrame(() => {
        quote.focus({ preventScroll: true });
        quote.scrollIntoView({ block: 'center', behavior: 'instant' });
      });
    },
  });

  quote.value = options.quote;
  quote.lang = 'und';
  transcript.textContent = options.previewText ?? options.quote;
  transcript.lang = 'und';
  find<HTMLAnchorElement>('.brand').addEventListener('click', (event) => event.preventDefault());
  help.addEventListener('click', () => {
    if (helpDialog.open) return;
    helpOpener = document.activeElement instanceof HTMLElement ? document.activeElement : help;
    helpDialog.showModal();
  });
  helpClose.addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('click', event => {
    if (event.target !== helpDialog) return;
    const rect = helpDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) helpDialog.close();
  });
  helpDialog.addEventListener('close', () => {
    const target = helpOpener?.isConnected ? helpOpener : help;
    target.focus({ preventScroll: true });
    helpOpener = null;
  });
  create.addEventListener('click', () => createCallback());
  example.addEventListener('click', () => exampleCallback());
  let selectQuoteOnClick = false;
  quote.addEventListener('pointerdown', () => {
    selectQuoteOnClick = document.activeElement !== quote;
  });
  quote.addEventListener('focus', () => {
    editCallback();
    quote.select();
  });
  quote.addEventListener('click', () => {
    // Native pointer focus can place the caret after the focus event's selection.
    if (selectQuoteOnClick) quote.select();
    selectQuoteOnClick = false;
  });
  quote.addEventListener('blur', () => { selectQuoteOnClick = false; });
  quote.addEventListener('pointercancel', () => { selectQuoteOnClick = false; });
  quote.addEventListener('input', () => {
    quote.lang = 'und';
    scheduleQuoteFontSize();
    if (!editing) { editing = true; updateState(); }
    editCallback();
  });
  quote.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !create.disabled) {
      event.preventDefault();
      createCallback();
    }
  });
  toggle.addEventListener('click', () => toggleCallback());
  replay.addEventListener('click', () => replayCallback());
  let seeking = false;
  let seekChanged = false;
  let seekPointer: number | null = null;
  let seekListeners: AbortController | null = null;

  function beginSeek() {
    if (seeking || progressTrack.disabled) return;
    seeking = true;
    seekChanged = false;
    seekStartCallback();
  }

  function seekTo(seconds: number) {
    progress = Math.max(0, Math.min(1, Number.isFinite(seconds) ? seconds / duration : 0));
    seekChanged = true;
    updateProgress();
    seekCallback(progress);
  }

  function endSeek(cancelled = false) {
    if (!seeking) return;
    if (!cancelled && !seekChanged && !progressTrack.disabled) seekTo(Number(progressTrack.value));
    seeking = false;
    seekPointer = null;
    seekListeners?.abort();
    seekListeners = null;
    seekEndCallback(cancelled);
  }

  progressTrack.addEventListener('pointerdown', event => {
    if (progressTrack.disabled || event.button !== 0 || seeking) return;
    seekPointer = event.pointerId;
    beginSeek();
    seekListeners = new AbortController();
    const options = { capture: true, signal: seekListeners.signal };
    window.addEventListener('pointerup', event => {
      if (event.pointerId === seekPointer) endSeek();
    }, options);
    window.addEventListener('pointercancel', event => {
      if (event.pointerId === seekPointer) endSeek(true);
    }, options);
    progressTrack.addEventListener('lostpointercapture', () => endSeek(true), options);
    window.addEventListener('blur', event => {
      // Moving keyboard focus to the range also blurs the previous control.
      // Only leaving the window cancels its active pointer gesture.
      if (event.target === window) endSeek(true);
    }, options);
    window.addEventListener('pagehide', () => endSeek(true), options);
  });
  progressTrack.addEventListener('input', () => {
    if (progressTrack.disabled) return;
    const seconds = Number(progressTrack.value);
    // Assistive technology can change a native range without a pointer gesture.
    beginSeek();
    seekTo(seconds);
    if (seekPointer === null) endSeek();
  });
  progressTrack.addEventListener('change', () => endSeek());
  progressTrack.addEventListener('keydown', event => {
    if (progressTrack.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowDown';
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const page = event.key === 'PageUp' || event.key === 'PageDown';
    if (!backward && !forward && !page && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    beginSeek();
    const seconds = progress * duration;
    const stride = page || event.shiftKey ? 5 : 1;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? duration
      : seconds + ((backward || event.key === 'PageDown') ? -stride : stride);
    seekTo(next);
    endSeek();
  });
  remix.addEventListener('click', () => remixCallback());
  download.addEventListener('click', () => downloadCallback());
  gifDownload.addEventListener('click', () => gifDownloadCallback());
  cancelExport.addEventListener('click', () => cancelExportCallback());
  for (const button of imageButtons) button.addEventListener('click', () => giphyPicker.open(button));
  imageFile.addEventListener('change', () => {
    const files = Array.from(imageFile.files ?? []);
    imageFile.value = '';
    if (files.length && !imageFile.disabled) imageImportCallback(files);
  });
  for (const gallery of imageGalleries) gallery.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.image-remove-button');
    if (button && !button.disabled) imageRemoveCallback(Number(button.dataset.imageIndex));
  });
  for (const button of placementButtons) button.addEventListener('click', () => {
    if (!button.disabled && button.dataset.mediaPlacement !== mediaPlacement) {
      mediaPlacementCallback(button.dataset.mediaPlacement as MediaPlacement);
    }
  });
  audio.addEventListener('click', () => {
    audioOpen = !audioOpen;
    updateAudio();
    if (audioOpen) audioImport.focus({ preventScroll: true });
  });
  audioPanel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    audioOpen = false;
    updateAudio();
    audio.focus({ preventScroll: true });
  });
  audioImport.addEventListener('click', () => audioFile.click());
  audioFile.addEventListener('change', () => {
    const file = audioFile.files?.[0];
    audioFile.value = '';
    if (file && !audioImport.disabled) audioImportCallback(file);
  });
  audioRemove.addEventListener('click', () => audioRemoveCallback());
  for (const button of audioPresetButtons) button.addEventListener('click', () => audioPresetCallback(button.dataset.audioPreset!));
  audioCredits.addEventListener('click', () => {
    if (audioCreditsDialog.open) return;
    creditsOpener = document.activeElement instanceof HTMLElement ? document.activeElement : audioCredits;
    creditCopyVersion += 1;
    for (const entry of audioCreditEntries) {
      if (entry.status) entry.status.textContent = '';
      if (entry.copyButton) entry.copyButton.disabled = false;
    }
    audioCreditsDialog.showModal();
  });
  audioCreditsClose.addEventListener('click', () => audioCreditsDialog.close());
  audioCreditsDialog.addEventListener('click', event => {
    if (event.target !== audioCreditsDialog) return;
    const rect = audioCreditsDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) audioCreditsDialog.close();
  });
  audioCreditsDialog.addEventListener('close', () => {
    creditCopyVersion += 1;
    const target = creditsOpener?.isConnected ? creditsOpener : audioCredits;
    target.focus({ preventScroll: true });
    creditsOpener = null;
  });
  for (const entry of audioCreditEntries) {
    const { copyButton, creditText, status } = entry;
    if (!copyButton || !creditText || !status) continue;
    copyButton.addEventListener('click', async () => {
      const version = ++creditCopyVersion;
      copyButton.disabled = true;
      status.textContent = '';
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(creditText.value);
        if (version === creditCopyVersion && audioCreditsDialog.open) status.textContent = strings(locale).audioCreditCopied;
      } catch {
        if (version === creditCopyVersion && audioCreditsDialog.open) {
          creditText.focus({ preventScroll: true });
          creditText.select();
          status.textContent = strings(locale).audioCreditSelect;
        }
      } finally {
        copyButton.disabled = false;
      }
    });
  }
  for (const input of [audioOffset, audioVolume]) {
    input.addEventListener('input', () => {
      if (!audioDetails || input.disabled) return;
      audioDetails = { ...audioDetails, offset: Number(audioOffset.value), volume: Number(audioVolume.value) };
      updateAudio();
      audioChangeCallback({ offset: audioDetails.offset, volume: audioDetails.volume });
    });
  }
  edit.addEventListener('click', () => {
    editing = true;
    updateState();
    editCallback();
    quote.focus({ preventScroll: false });
  });

  function buttonLabel(button: HTMLButtonElement, label: string) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }

  function updateProgress() {
    progressTrack.max = String(duration);
    progressTrack.value = String(progress * duration);
    progressTrack.style.setProperty('--seek-position', `${progress * 100}%`);
    progressTrack.setAttribute('aria-valuetext', strings(locale).seekPosition(progress * duration, duration));
    const time = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    timecode.innerHTML = `${time(progress * duration)} <span>/ ${time(duration)}</span>`;
  }

  function updateAudio() {
    const copy = strings(locale);
    const blocked = imageLoading || audioLoading || state === 'preparing' || state === 'exporting';
    studio.dataset.audioOpen = String(audioOpen);
    studio.dataset.hasAudio = String(!!audioDetails);
    audioPanel.hidden = !audioOpen;
    audioPanel.setAttribute('aria-busy', String(audioLoading));
    audio.setAttribute('aria-expanded', String(audioOpen));
    audio.dataset.hasAudio = String(!!audioDetails);
    audio.disabled = blocked;
    buttonLabel(audio, audioDetails ? `${copy.audioReplace}: ${audioDetails.name}` : copy.audio);
    buttonLabel(audioImport, audioDetails ? copy.audioReplace : copy.audioChoose);
    buttonLabel(audioRemove, copy.audioRemove);
    audioImport.disabled = blocked;
    audioRemove.disabled = blocked;
    audioOffset.disabled = blocked || !audioDetails;
    audioVolume.disabled = blocked || !audioDetails;
    audioFile.disabled = blocked;
    find<HTMLElement>('.audio-presets').setAttribute('aria-label', copy.audioOriginals);
    for (const button of audioPresetButtons) {
      const id = button.dataset.audioPreset ?? '';
      const label = isBuiltinAudioId(id) ? getBuiltinAudio(id).title : copy.audio;
      button.textContent = label;
      buttonLabel(button, `${copy.audioOriginals}: ${label}`);
      button.disabled = blocked;
      button.setAttribute('aria-pressed', String(audioDetails?.presetId === button.dataset.audioPreset));
    }
    find<HTMLElement>('.audio-source-name').textContent = audioLoading ? copy.audioLoading : audioDetails?.name ?? copy.audioChoose;
    audioRemove.hidden = !audioDetails;
    find<HTMLElement>('.audio-settings').hidden = !audioDetails;
    find<HTMLElement>('.audio-offset-label').textContent = copy.audioOffset;
    find<HTMLElement>('.audio-volume-label').textContent = copy.audioVolume;
    audioOffset.setAttribute('aria-label', copy.audioOffsetLabel);
    audioVolume.setAttribute('aria-label', copy.audioVolumeLabel);
    const maximumOffset = Math.max(0, (audioDetails?.duration ?? 0) - 0.1);
    const offset = Math.max(0, Math.min(maximumOffset, audioDetails?.offset ?? 0));
    const volume = Math.max(0, Math.min(1, audioDetails?.volume ?? 0.7));
    audioOffset.max = String(maximumOffset);
    audioOffset.value = String(offset);
    audioVolume.value = String(volume);
    const offsetText = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(offset)} s`;
    const volumeText = `${Math.round(volume * 100)} %`;
    audioOffset.setAttribute('aria-valuetext', offsetText);
    audioVolume.setAttribute('aria-valuetext', volumeText);
    find<HTMLElement>('.audio-offset-value').textContent = offsetText;
    find<HTMLElement>('.audio-volume-value').textContent = volumeText;
    for (const entry of audioCreditEntries) entry.entry.dataset.selected = String(audioDetails?.presetId === entry.track.id);
  }

  function updateAudioCredits() {
    const copy = strings(locale);
    audioCredits.textContent = copy.audioCredits;
    buttonLabel(audioCredits, copy.audioCredits);
    find<HTMLElement>('#audio-credits-title').textContent = copy.audioCredits;
    find<HTMLElement>('#audio-credits-description').textContent = copy.audioCreditsDescription;
    buttonLabel(audioCreditsClose, copy.audioCreditsClose);
    for (const entry of audioCreditEntries) {
      if (entry.provided) entry.provided.textContent = copy.audioCreditsProvided;
      if (entry.source) entry.source.textContent = copy.audioCreditsSource;
      if (entry.copyButton) {
        entry.copyButton.textContent = copy.audioCreditCopy;
        buttonLabel(entry.copyButton, `${copy.audioCreditCopy}: ${entry.track.title}`);
      }
      if (entry.creditText) entry.creditText.setAttribute('aria-label', `${copy.audioCreditText}: ${entry.track.title}`);
      if (entry.status) entry.status.textContent = '';
    }
  }

  function updateImage() {
    const copy = strings(locale);
    const blocked = imageLoading || audioLoading || state === 'preparing' || state === 'exporting';
    studio.dataset.hasImage = String(imageDetails.length > 0);
    studio.dataset.imageCount = String(imageDetails.length);
    studio.dataset.hasGiphy = String(imageDetails.some(image => image.attribution?.provider === 'giphy'));
    studio.dataset.mediaPlacement = mediaPlacement;
    for (const group of placementGroups) {
      group.hidden = !imageDetails.length;
      group.setAttribute('aria-label', copy.mediaPlacement);
    }
    for (const button of placementButtons) {
      button.disabled = blocked;
      const placement = button.dataset.mediaPlacement as MediaPlacement;
      button.textContent = placement === 'before' ? copy.mediaBeforeText : copy.mediaAfterText;
      button.setAttribute('aria-pressed', String(placement === mediaPlacement));
    }
    giphyPicker.setBusy(blocked);
    giphyPicker.setCount(imageDetails.length);
    const full = imageDetails.length >= MAX_IMAGE_COUNT;
    imageFile.disabled = blocked || full;
    for (const button of imageButtons) {
      button.disabled = blocked || full;
      button.dataset.hasImage = String(imageDetails.length > 0);
      button.setAttribute('aria-busy', String(imageLoading));
      buttonLabel(button, imageLoading ? copy.imageLoading : full ? `${copy.imageChoose} · ${MAX_IMAGE_COUNT}/${MAX_IMAGE_COUNT}` : copy.imageChoose);
    }
    for (const gallery of imageGalleries) {
      gallery.hidden = !imageDetails.length;
      gallery.setAttribute('aria-busy', String(imageLoading));
      for (const item of gallery.querySelectorAll<HTMLElement>('.image-item')) {
        const details = imageDetails[Number(item.dataset.imageIndex)];
        if (!details) continue;
        const label = details.video ? `${details.name} · ${copy.videoMedia}`
          : details.animation ? `${details.name} · ${copy.imageAnimated}` : details.name;
        item.title = label;
        item.querySelector<HTMLImageElement>('.image-thumb')!.alt = label;
        const badge = item.querySelector<HTMLElement>('.image-gif-badge');
        if (badge) badge.title = copy.imageAnimated;
        const videoBadge = item.querySelector<HTMLElement>('.image-video-badge');
        if (videoBadge) videoBadge.title = copy.videoMedia;
      }
      for (const button of gallery.querySelectorAll<HTMLButtonElement>('.image-remove-button')) {
        const details = imageDetails[Number(button.dataset.imageIndex)];
        button.disabled = blocked;
        buttonLabel(button, `${copy.imageRemove}: ${details?.name ?? ''}`);
      }
    }
  }

  function renderImageGalleries() {
    for (const gallery of imageGalleries) {
      gallery.replaceChildren(...imageDetails.map((details, index) => {
        const item = document.createElement('div');
        item.className = 'image-item';
        item.dataset.imageIndex = String(index);
        item.title = details.name;
        const thumbnail = document.createElement('img');
        thumbnail.className = 'image-thumb';
        thumbnail.alt = details.name;
        thumbnail.src = details.animation?.frames[0]?.source ?? details.source;
        const name = document.createElement('span');
        name.className = 'image-source-name sr-only';
        name.textContent = details.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'image-remove-button icon-button';
        remove.dataset.imageIndex = String(index);
        remove.innerHTML = icon('cancel');
        item.append(thumbnail, name, remove);
        if (details.animation || details.video) {
          const badge = document.createElement('span');
          badge.className = details.video ? 'image-video-badge' : 'image-gif-badge';
          badge.textContent = details.video ? '▶' : 'GIF';
          badge.setAttribute('aria-hidden', 'true');
          badge.style.cssText = 'position:absolute;left:2px;bottom:2px;padding:2px 3px;border-radius:2px;background:var(--page);color:var(--white);font-size:8px;line-height:1;pointer-events:none';
          item.append(badge);
        }
        return item;
      }));
    }
    for (const credits of imageAttributions) {
      credits.replaceChildren(...imageDetails.flatMap(details => {
        const source = details.attribution;
        if (!source) return [];
        const entry = document.createElement('span');
        entry.className = 'image-attribution';
        const link = document.createElement('a');
        link.href = source.pageUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'GIPHY';
        link.title = details.name;
        entry.append(link);
        if (source.creatorName) {
          const creator = document.createElement('a');
          creator.href = source.creatorUrl ?? source.pageUrl;
          creator.target = '_blank';
          creator.rel = 'noopener noreferrer';
          creator.textContent = source.creatorName;
          entry.append(document.createTextNode(' · '), creator);
        }
        return [entry];
      }));
      credits.hidden = !credits.childElementCount;
    }
  }

  function updateExport() {
    const copy = strings(locale);
    exportPanel.hidden = !exportProgress;
    const value = exportProgress?.value;
    const hasValue = value !== undefined && Number.isFinite(value);
    exportTrack.classList.toggle('is-indeterminate', !hasValue);
    exportFill.style.transform = `scaleX(${hasValue ? Math.max(0, Math.min(1, value)) : 0.18})`;
    if (hasValue) exportTrack.setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(1, value)) * 100)));
    else exportTrack.removeAttribute('aria-valuenow');
    exportTrack.setAttribute('aria-label', copy.exporting);
    find<HTMLElement>('.export-status').textContent = hasValue ? copy.exportProgress(Math.max(0, Math.min(1, value))) : copy.exporting;
    const { format, width, height } = exportProgress ?? {};
    find<HTMLElement>('.export-format').textContent = format && width && height ? copy.exportDetails(format, width, height) : '';
  }

  function updateLabels() {
    const copy = strings(locale);
    easterEggs.setLocale();
    giphyPicker.updateLocale();
    document.documentElement.lang = locale;
    find<HTMLElement>('.tagline').textContent = copy.tagline;
    find<HTMLElement>('.demo-label').textContent = copy.demo;
    find<HTMLElement>('.create-label').textContent = copy.create;
    find<HTMLElement>('.footer-credit').textContent = copy.credit;
    find<HTMLElement>('.footer-source-label').textContent = copy.sourceCode;
    find<HTMLAnchorElement>('.footer-source').setAttribute('aria-label', copy.sourceCodeLabel);
    find<HTMLElement>('.film-duration').textContent = copy.duration(Math.round(duration * 10) / 10);
    const secretBadge = find<HTMLElement>('.film-secret');
    secretBadge.hidden = !activeSecret;
    secretBadge.textContent = activeSecret ? `${copy.secretFilm} · ${activeSecret.name[locale]}` : '';
    secretBadge.title = activeSecret ? copy.secretFilmExport : '';
    quote.setAttribute('aria-label', copy.quote);
    quote.placeholder = copy.placeholder;
    canvas.setAttribute('aria-label', copy.stage);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-describedby', 'film-transcript');
    stage.setAttribute('aria-label', copy.format(Math.round(duration * 10) / 10, format));
    find<HTMLElement>('.format-switch').setAttribute('aria-label', copy.filmFormat);
    for (const button of formatButtons) {
      const vertical = button.dataset.filmFormat === 'vertical';
      button.querySelector<HTMLElement>('.format-name')!.textContent = vertical ? copy.formatVertical : copy.formatSquare;
      button.setAttribute('aria-pressed', String(button.dataset.filmFormat === format));
      buttonLabel(button, vertical ? copy.formatVerticalLabel : copy.formatSquareLabel);
    }
    buttonLabel(create, copy.createLabel);
    buttonLabel(example, copy.example);
    buttonLabel(help, copy.help);
    buttonLabel(helpClose, copy.helpClose);
    find<HTMLElement>('#help-title').textContent = copy.helpTitle;
    find<HTMLElement>('.help-create-title').textContent = copy.helpCreateTitle;
    find<HTMLElement>('.help-create').textContent = copy.helpCreate;
    find<HTMLElement>('.help-remix-title').textContent = copy.helpRemixTitle;
    find<HTMLElement>('.help-remix').textContent = copy.helpRemix;
    find<HTMLElement>('.help-colors-title').textContent = copy.helpColorsTitle;
    find<HTMLElement>('.help-colors').textContent = copy.helpColors;
    find<HTMLElement>('.help-fonts-title').textContent = copy.helpFontsTitle;
    find<HTMLElement>('.help-fonts').textContent = copy.helpFonts;
    find<HTMLElement>('.help-audio-title').textContent = copy.helpAudioTitle;
    find<HTMLElement>('.help-audio').textContent = copy.helpAudio;
    find<HTMLElement>('.help-photos-title').textContent = copy.helpPhotosTitle;
    find<HTMLElement>('.help-photos').textContent = copy.helpPhotos;
    find<HTMLElement>('.help-download-title').textContent = copy.helpDownloadTitle;
    find<HTMLElement>('.help-download').textContent = copy.helpDownload;
    find<HTMLElement>('.help-local').textContent = copy.helpLocal;
    progressTrack.setAttribute('aria-label', copy.seek);
    updateProgress();
    find<HTMLElement>('.locale-switch').setAttribute('aria-label', copy.language);
    find<HTMLElement>('.theme-switch').setAttribute('aria-label', copy.theme);

    for (const button of localeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.locale === locale));
      buttonLabel(button, button.dataset.locale === 'fr' ? copy.french : copy.english);
    }
    for (const button of themeButtons) {
      const family = themeFamilies.find(candidate => candidate.id === button.dataset.theme);
      const automatic = button.dataset.theme === 'auto';
      button.setAttribute('aria-pressed', String(automatic ? automaticTheme : !automaticTheme && family?.id === getThemeFamilyId(themeId)));
      buttonLabel(button, automatic ? copy.themeAuto : copy[family!.labelKey]);
    }
    buttonLabel(toggle, state === 'playing' ? copy.pause : copy.play);
    toggle.innerHTML = icon(state === 'playing' ? 'pause' : 'play');
    buttonLabel(replay, copy.replay);
    buttonLabel(remix, copy.remix);
    buttonLabel(download, exportAvailable ? copy.download : copy.exportUnavailable);
    buttonLabel(gifDownload, copy.gifDownload);
    gifDownload.title = `${copy.gifDownload} · ${copy.gifDownloadHint}`;
    find<HTMLElement>('#gif-download-hint').textContent = copy.gifDownloadHint;
    buttonLabel(edit, copy.edit);
    buttonLabel(cancelExport, copy.cancelExport);
    find<HTMLElement>('.state-announcement').textContent = state === 'idle' ? copy.ready : copy[state];
    updateImage();
    const currentFont = getDisplayFont(fontId);
    const filmFont = getDisplayFont(filmFontId);
    buttonLabel(find<HTMLButtonElement>('.font-editor-button'), copy.fontCurrent(currentFont.name));
    buttonLabel(find<HTMLButtonElement>('.font-film-button'), copy.fontCurrent(filmFont.name));
    fontPicker.updateLocale();
    updateAudio();
    updateAudioCredits();
    updateExport();
    scheduleQuoteFontSize();
  }

  function updateState() {
    studio.dataset.state = state;
    studio.dataset.editing = String(editing);
    studio.dataset.hasFilm = String(hasFilm);
    const busy = imageLoading || audioLoading || state === 'preparing' || state === 'exporting';
    const visibleFilm = hasFilm || !['idle', 'error'].includes(state);
    stage.setAttribute('aria-busy', String(busy));
    create.disabled = busy;
    example.disabled = busy;
    create.hidden = !editing;
    quote.readOnly = busy;
    playback.hidden = !visibleFilm || state === 'exporting';
    progressTrack.disabled = busy || !hasFilm;
    if (progressTrack.disabled) endSeek(true);
    toggle.disabled = busy;
    replay.disabled = busy;
    remix.disabled = busy;
    download.disabled = busy || !exportAvailable;
    gifDownload.hidden = !hasFilm;
    gifDownload.disabled = busy || !hasFilm || !gifExportAvailable;
    edit.disabled = busy;
    toggle.hidden = state === 'ended';
    for (const button of themeButtons) button.disabled = busy;
    for (const button of fontButtons) button.disabled = busy;
    for (const button of formatButtons) button.disabled = busy;
    fontPicker.setDisabled(busy);
    updateLabels();
  }

  for (const button of localeButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.locale as Locale;
      if (next === locale) return;
      locale = next;
      updateLabels();
      localeCallback(locale);
    });
  }
  for (const button of themeButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.theme!;
      if (next === 'auto') {
        automaticTheme = true;
        updateLabels();
        themeCallback(null);
        return;
      }
      if (!automaticTheme && next === getThemeFamilyId(themeId)) return;
      automaticTheme = false;
      updateLabels();
      themeCallback(next);
    });
  }
  for (const button of formatButtons) {
    button.addEventListener('click', async () => {
      const next = button.dataset.filmFormat as FilmFormat;
      if (button.disabled || next === format) return;
      const hadFocus = document.activeElement === button;
      try {
        await formatCallback(next);
      } finally {
        if (hadFocus && document.activeElement === document.body && button.isConnected && !button.disabled) {
          button.focus({ preventScroll: true });
        }
      }
    });
  }

  function updateTheme() {
    stage.style.setProperty('--stage-background', getTheme(themeId).background);
    studio.dataset.theme = themeId;
    studio.dataset.automaticTheme = String(automaticTheme);
    updateLabels();
  }

  setFont(fontId);
  setFormat(format);
  updateTheme();
  updateState();

  return {
    canvas,
    stage,
    getInput() { return { text: quote.value, fontId, format }; },
    getFormat() { return format; },
    onCreate(callback) { createCallback = callback; },
    onExample(callback) { exampleCallback = callback; },
    onTogglePlayback(callback) { toggleCallback = callback; },
    onReplay(callback) { replayCallback = callback; },
    onSeekStart(callback) { seekStartCallback = callback; },
    onSeek(callback) { seekCallback = callback; },
    onSeekEnd(callback) { seekEndCallback = callback; },
    onRemix(callback) { remixCallback = callback; },
    onDownload(callback) { downloadCallback = callback; },
    onGifDownload(callback) { gifDownloadCallback = callback; },
    onCancelExport(callback) { cancelExportCallback = callback; },
    onEdit(callback) { editCallback = callback; },
    onThemeChange(callback) { themeCallback = callback; },
    onFontChange(callback) { fontCallback = callback; },
    onFormatChange(callback) { formatCallback = callback; },
    onImageImport(callback) { imageImportCallback = callback; },
    onGiphySelect(callback) { giphySelectCallback = callback; },
    onImageRemove(callback) { imageRemoveCallback = callback; },
    onMediaPlacementChange(callback) { mediaPlacementCallback = callback; },
    onAudioImport(callback) { audioImportCallback = callback; },
    onAudioRemove(callback) { audioRemoveCallback = callback; },
    onAudioPreset(callback) { audioPresetCallback = callback; },
    onAudioChange(callback) { audioChangeCallback = callback; },
    onLocaleChange(callback) { localeCallback = callback; },
    getLocale() { return locale; },
    setExampleText,
    setFont,
    setFormat,
    setFilm(film, preserveEditing = false) {
      duration = Math.max(0.1, film.duration);
      themeId = film.themeId;
      if (film.fontId) {
        filmFontId = film.fontId;
        if (!preserveEditing || !editing) setFont(film.fontId);
      }
      hasFilm = true;
      activeSecret = film.secretFilm ? findSecretFilm(film.text) : null;
      if (activeSecret) easterEggs.discoverFilm(activeSecret.id);
      if (!preserveEditing) editing = false;
      transcript.textContent = film.text;
      transcript.lang = film.language;
      if (quote.value === film.text) quote.lang = film.language;
      canvas.dataset.seed = String(film.seed);
      updateTheme();
      updateState();
      updateProgress();
    },
    setPreview(film) {
      duration = Math.max(0.1, film.duration);
      themeId = film.themeId;
      if (film.fontId) { filmFontId = film.fontId; setFont(film.fontId); }
      transcript.textContent = film.text;
      transcript.lang = film.language;
      if (quote.value === film.text) quote.lang = film.language;
      canvas.dataset.seed = String(film.seed);
      updateTheme();
      updateProgress();
    },
    setTheme(nextThemeId, automatic) {
      themeId = nextThemeId;
      automaticTheme = automatic;
      updateTheme();
    },
    setImages(details) {
      const removedFocusedImage = document.activeElement instanceof Element && document.activeElement.matches('.image-remove-button');
      imageDetails = [...details];
      renderImageGalleries();
      updateImage();
      if (removedFocusedImage) find<HTMLButtonElement>(editing ? '.image-editor-button' : '.image-film-button').focus({ preventScroll: true });
    },
    setMediaPlacement(placement) {
      mediaPlacement = placement;
      updateImage();
    },
    setImageLoading(loading) {
      imageLoading = loading;
      updateState();
    },
    setAudio(details) {
      const removedFocusedAudio = !details && document.activeElement === audioRemove;
      audioDetails = details;
      updateAudio();
      if (removedFocusedAudio) audioImport.focus({ preventScroll: true });
    },
    setAudioLoading(loading) {
      audioLoading = loading;
      updateState();
    },
    setState(next, preserveEditing = false) {
      state = next;
      if (next === 'idle' || next === 'error') editing = true;
      else if (next === 'preparing' && !preserveEditing) editing = false;
      updateState();
    },
    setEditing(value) { editing = value; updateState(); },
    setProgress(value) {
      progress = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
      updateProgress();
    },
    setExportProgress(value) { exportProgress = value; updateExport(); },
    setExportAvailable(value) { exportAvailable = value; updateState(); },
    setGifExportAvailable(value) { gifExportAvailable = value; updateState(); },
    setMessage(value) {
      message.textContent = value ?? '';
      message.hidden = !value;
      updateMessageSpace();
    },
  };
}
