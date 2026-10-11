import { DEFAULT_FONT_ID, getDisplayFont, GlyphCoverageError, listDisplayFonts, loadDisplayFont, type DisplayFont, type FontCharacter } from '../typography/fonts';
import { FontImportError, importDisplayFont, localFontsAvailable, queryLocalFonts, type LocalFont } from '../typography/font-import';
import { strings, type Locale } from './i18n';
import { icon } from './icons';

interface FontPickerOptions {
  getLocale(): Locale;
  getSample(): string;
  onChange(fontId: string): void | Promise<void>;
}

type Copy = ReturnType<typeof strings>;
type StatusCopy = (copy: Copy) => string;
const MAX_VISIBLE_DEVICE_FONTS = 100;

/** Local font access is requested only by the device-font button's click. */
export function createFontPicker(host: HTMLElement, options: FontPickerOptions) {
  const dialog = document.createElement('dialog');
  dialog.id = 'font-picker';
  dialog.className = 'font-dialog';
  dialog.setAttribute('aria-labelledby', 'font-picker-title');
  dialog.setAttribute('aria-describedby', 'font-picker-description');
  dialog.innerHTML = `
    <div class="font-heading"><h2 id="font-picker-title"></h2><button class="font-close icon-button" type="button">${icon('cancel')}</button></div>
    <p id="font-picker-description" class="font-description"></p>
    <label class="sr-only" for="font-search"></label>
    <input id="font-search" class="font-search" type="search" autocomplete="off">
    <section class="font-section" aria-labelledby="font-included-title"><h3 id="font-included-title"></h3><div class="font-options" role="group"></div></section>
    <div class="font-source-actions"><button class="font-device-button" type="button"></button><button class="font-import-button" type="button"></button></div>
    <input class="font-file" type="file" accept=".ttf,.otf,font/ttf,font/otf" hidden>
    <p class="font-device-note"></p>
    <section class="font-device-section font-section" aria-labelledby="font-device-title" hidden><h3 id="font-device-title"></h3><div class="font-device-options" role="group"></div><p class="font-device-limit" hidden></p></section>
    <p class="font-status" role="status" aria-live="polite" tabindex="-1"></p>`;
  host.append(dialog);

  const find = <T extends Element>(selector: string): T => dialog.querySelector<T>(selector)!;
  const close = find<HTMLButtonElement>('.font-close');
  const search = find<HTMLInputElement>('.font-search');
  const choices = find<HTMLElement>('.font-options');
  const deviceChoices = find<HTMLElement>('.font-device-options');
  const deviceSection = find<HTMLElement>('.font-device-section');
  const deviceLimit = find<HTMLElement>('.font-device-limit');
  const device = find<HTMLButtonElement>('.font-device-button');
  const upload = find<HTMLButtonElement>('.font-import-button');
  const file = find<HTMLInputElement>('.font-file');
  const status = find<HTMLElement>('.font-status');
  let fontId = DEFAULT_FONT_ID;
  let disabled = false;
  let selecting = false;
  let localFonts: LocalFont[] = [];
  let operationVersion = 0;
  let opener: HTMLElement | null = null;
  let pendingFocus: HTMLElement | null = null;
  let statusCopy: StatusCopy = () => '';
  const copy = () => strings(options.getLocale());

  function label(button: HTMLButtonElement, value: string) {
    button.title = value;
    button.setAttribute('aria-label', value);
  }

  function restoreFocus() {
    queueMicrotask(() => {
      if (dialog.open || disabled || !pendingFocus) return;
      if (!pendingFocus.isConnected || !pendingFocus.getClientRects().length) { pendingFocus = null; return; }
      if (pendingFocus.matches(':disabled')) return;
      pendingFocus.focus({ preventScroll: true });
      pendingFocus = null;
    });
  }

  function updateControls() {
    const blocked = disabled || selecting;
    search.disabled = blocked;
    device.disabled = blocked;
    upload.disabled = blocked;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('.font-option')) button.disabled = blocked;
    dialog.setAttribute('aria-busy', String(selecting));
    status.textContent = selecting ? copy().fontLoading : statusCopy(copy());
  }

  function sampleText() {
    return options.getSample().trim().replace(/\s+/gu, ' ').slice(0, 72) || copy().fontSample;
  }

  function characterLabel(character: FontCharacter) {
    const text = copy();
    return { block: text.fontStyleBlock, stencil: text.fontStyleStencil, slab: text.fontStyleSlab,
      pixel: text.fontStylePixel, condensed: text.fontStyleCondensed, geometric: text.fontStyleGeometric }[character];
  }

  function option(name: string, family: string, weight: string, style: string, selected: boolean, onSelect: () => void, character?: FontCharacter) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'font-option';
    button.setAttribute('aria-pressed', String(selected));
    label(button, copy().fontChoose(name));
    const heading = document.createElement('span');
    heading.className = 'font-option-name';
    heading.textContent = name;
    const sample = document.createElement('span');
    sample.className = 'font-option-sample';
    sample.textContent = sampleText();
    sample.lang = 'und';
    sample.setAttribute('aria-hidden', 'true');
    sample.style.fontFamily = `${JSON.stringify(family)}, sans-serif`;
    sample.style.fontWeight = weight;
    sample.style.fontStyle = style;
    const title = document.createElement('span');
    title.className = 'font-option-heading';
    title.append(heading);
    if (character) {
      const badge = document.createElement('span');
      badge.className = 'font-option-character';
      badge.textContent = characterLabel(character);
      title.append(badge);
      button.dataset.fontCharacter = character;
    }
    button.append(title, sample);
    button.addEventListener('click', onSelect);
    return button;
  }

  function renderChoices() {
    const query = search.value.trim().toLocaleLowerCase(options.getLocale());
    const matches = (name: string) => name.toLocaleLowerCase(options.getLocale()).includes(query);
    const fonts = listDisplayFonts().filter(font => matches(font.name) || (font.character && matches(characterLabel(font.character))));
    choices.replaceChildren(...fonts.map(font => {
      const button = option(font.name, font.family, String(font.weight), font.style, font.id === fontId, () => {
        void select(() => loadDisplayFont(font.id).then(() => font));
      }, font.character);
      button.dataset.fontId = font.id;
      return button;
    }));
    const visibleLocalFonts = localFonts.filter(font => matches(font.fullName));
    deviceChoices.replaceChildren(...visibleLocalFonts.slice(0, MAX_VISIBLE_DEVICE_FONTS).map(font => option(
      font.fullName, font.family, /black|heavy/i.test(font.style) ? '900' : /bold/i.test(font.style) ? '700' : '400',
      /italic|oblique/i.test(font.style) ? 'italic' : 'normal', false,
      () => { void select(async () => importDisplayFont(await font.blob(), font.fullName)); },
    )));
    deviceSection.hidden = localFonts.length === 0;
    deviceLimit.hidden = visibleLocalFonts.length <= MAX_VISIBLE_DEVICE_FONTS;
    deviceLimit.textContent = copy().fontDeviceLimit(MAX_VISIBLE_DEVICE_FONTS, visibleLocalFonts.length);
    if (!fonts.length && !visibleLocalFonts.length) statusCopy = text => text.fontEmpty;
    else if (statusCopy(copy()) === copy().fontEmpty) statusCopy = () => '';
    updateControls();
  }

  function failure(error: unknown): StatusCopy {
    if (error instanceof GlyphCoverageError) return text => error.kind === 'emoji'
      ? text.unsupportedEmoji(error.characters.join(' ')) : text.unsupportedCharacters(error.characters.join(' '));
    if (error instanceof FontImportError) {
      if (error.kind === 'permission') return text => text.fontPermissionError;
      if (error.kind === 'unavailable') return text => text.fontUnavailable;
      if (error.kind === 'size') return text => text.fontSizeError;
      if (error.kind === 'format') return text => text.fontFormatError;
      if (error.kind === 'coverage') return text => text.fontCoverageError;
      return text => text.fontDecodeError;
    }
    return text => text.fontApplyError;
  }

  async function select(load: () => Promise<DisplayFont>) {
    if (disabled || selecting || !dialog.open) return;
    const version = ++operationVersion;
    let failed = false;
    selecting = true;
    statusCopy = () => '';
    updateControls();
    try {
      const font = await load();
      if (version !== operationVersion || !dialog.open) return;
      await options.onChange(font.id);
      if (version !== operationVersion || !dialog.open) return;
      fontId = font.id;
      dialog.close();
    } catch (error) {
      if (version !== operationVersion || !dialog.open) return;
      statusCopy = failure(error);
      failed = true;
    } finally {
      if (version === operationVersion) {
        selecting = false;
        renderChoices();
        if (failed) status.focus({ preventScroll: true });
      }
    }
  }

  async function loadDeviceFonts() {
    if (disabled || selecting) return;
    const version = ++operationVersion;
    let failed = false;
    selecting = true;
    statusCopy = () => '';
    updateControls();
    try {
      const fonts = await queryLocalFonts();
      if (version !== operationVersion || !dialog.open) return;
      localFonts = [...fonts].sort((a, b) => a.fullName.localeCompare(b.fullName, options.getLocale()));
      statusCopy = localFonts.length ? () => '' : text => text.fontDeviceEmpty;
    } catch (error) {
      if (version !== operationVersion || !dialog.open) return;
      statusCopy = failure(error);
      failed = true;
    } finally {
      if (version === operationVersion) {
        selecting = false;
        renderChoices();
        if (failed) status.focus({ preventScroll: true });
      }
    }
  }

  function updateLocale() {
    const text = copy();
    dialog.lang = options.getLocale();
    find<HTMLElement>('#font-picker-title').textContent = text.fontTitle;
    find<HTMLElement>('#font-picker-description').textContent = text.fontDescription;
    find<HTMLElement>('#font-included-title').textContent = text.fontIncluded;
    choices.setAttribute('aria-label', text.fontIncluded);
    find<HTMLElement>('#font-device-title').textContent = text.fontDevice;
    deviceChoices.setAttribute('aria-label', text.fontDevice);
    find<HTMLLabelElement>('label[for="font-search"]').textContent = text.fontSearch;
    search.placeholder = text.fontSearch;
    device.textContent = text.fontDevice;
    device.hidden = !localFontsAvailable();
    upload.textContent = text.fontImport;
    find<HTMLElement>('.font-device-note').textContent = localFontsAvailable() ? text.fontDeviceNote : text.fontUnavailable;
    label(close, text.fontClose);
    renderChoices();
  }

  close.addEventListener('click', () => dialog.close());
  search.addEventListener('input', renderChoices);
  device.addEventListener('click', () => { void loadDeviceFonts(); });
  upload.addEventListener('click', () => { if (!upload.disabled) file.click(); });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (selected) void select(() => importDisplayFont(selected, selected.name));
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    operationVersion++;
    selecting = false;
    pendingFocus = opener;
    opener = null;
    restoreFocus();
  });
  updateLocale();

  return {
    open(target: HTMLElement) {
      if (disabled || dialog.open) return;
      opener = target;
      pendingFocus = null;
      statusCopy = () => '';
      search.value = '';
      updateLocale();
      dialog.showModal();
      (choices.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? close).focus({ preventScroll: true });
      for (const font of listDisplayFonts()) void loadDisplayFont(font.id).catch(() => undefined);
    },
    setFont(id: string) { fontId = getDisplayFont(id).id; if (dialog.open) renderChoices(); },
    setDisabled(value: boolean) { disabled = value; updateControls(); if (!disabled) restoreFocus(); },
    updateLocale,
  };
}
