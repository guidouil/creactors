import poweredByGiphy from '../../assets/giphy/powered-by-giphy.png';
import { GiphyError, hasGiphyApiKey, searchGiphy, type GiphyResult } from '../image/giphy';
import { ImageImportError, MAX_IMAGE_COUNT, MAX_IMAGE_FILE_BYTES } from '../image/types';
import { FinalImageDurationError } from '../scene/final-image';
import { icon } from './icons';
import { strings, type Locale } from './i18n';

interface GiphyPickerOptions {
  getLocale(): Locale;
  onSelect(result: GiphyResult, signal: AbortSignal): Promise<void>;
  onLocal(): void;
}

type Copy = ReturnType<typeof strings>;
type StatusCopy = (copy: Copy) => string;
interface SearchRequest { query: string; offset: number; append: boolean }

/** Network access starts only when this chooser is opened or submitted. */
export function createGiphyPicker(host: HTMLElement, options: GiphyPickerOptions) {
  const dialog = document.createElement('dialog');
  dialog.id = 'final-media-picker';
  dialog.className = 'giphy-dialog';
  dialog.setAttribute('aria-labelledby', 'final-media-title');
  dialog.innerHTML = `
    <div class="giphy-heading">
      <div><h2 id="final-media-title"></h2><p class="giphy-count"></p></div>
      <button class="giphy-close icon-button" type="button">${icon('cancel')}</button>
    </div>
    <button class="giphy-local-button" type="button">${icon('image')}<span></span></button>
    <section class="giphy-search-section" aria-labelledby="giphy-search-title">
      <div class="giphy-search-heading"><h3 id="giphy-search-title"></h3><a class="giphy-brand" href="https://giphy.com/" target="_blank" rel="noopener noreferrer"><img width="200" src="${poweredByGiphy}" alt=""></a></div>
      <form class="giphy-search-form">
        <label class="sr-only" for="giphy-search-query"></label>
        <input id="giphy-search-query" class="giphy-search-input" type="search" maxlength="50" autocomplete="off">
        <button class="giphy-search-button" type="submit"></button>
      </form>
      <p class="giphy-network-note"></p>
      <div class="giphy-status-row"><p class="giphy-status" role="status"></p><button class="giphy-retry-button" type="button" hidden></button></div>
      <div class="giphy-results" role="list"></div>
      <button class="giphy-more-button" type="button" hidden></button>
    </section>`;
  host.append(dialog);

  const find = <T extends Element>(selector: string): T => dialog.querySelector<T>(selector)!;
  const close = find<HTMLButtonElement>('.giphy-close');
  const local = find<HTMLButtonElement>('.giphy-local-button');
  const form = find<HTMLFormElement>('.giphy-search-form');
  const input = find<HTMLInputElement>('.giphy-search-input');
  const submit = find<HTMLButtonElement>('.giphy-search-button');
  const grid = find<HTMLElement>('.giphy-results');
  const status = find<HTMLElement>('.giphy-status');
  const retry = find<HTMLButtonElement>('.giphy-retry-button');
  const more = find<HTMLButtonElement>('.giphy-more-button');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let opener: HTMLElement | null = null;
  let pendingFocus: HTMLElement | null = null;
  let focusQueued = false;
  let lastLocale: Locale | null = null;
  let busy = false;
  let count = 0;
  let searching = false;
  let selecting = false;
  let query = '';
  let nextOffset = 0;
  let hasMore = false;
  let results: GiphyResult[] = [];
  let requestVersion = 0;
  let selectionVersion = 0;
  let searchController: AbortController | null = null;
  let selectionController: AbortController | null = null;
  let failedRequest: SearchRequest | null = null;
  let statusCopy: StatusCopy = copy => copy.giphyReady;

  const copy = () => strings(options.getLocale());

  function label(button: HTMLButtonElement, value: string) {
    button.setAttribute('aria-label', value);
    button.title = value;
  }

  function restoreFocus() {
    if (!pendingFocus || focusQueued) return;
    focusQueued = true;
    // The host re-enables its image button after calling setBusy(false).
    queueMicrotask(() => {
      focusQueued = false;
      if (dialog.open || busy || !pendingFocus) return;
      const target = pendingFocus;
      if (!target.isConnected || !target.getClientRects().length) {
        pendingFocus = null;
        return;
      }
      if (target.matches(':disabled, [aria-disabled="true"]')) return;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) pendingFocus = null;
    });
  }

  function updateControls() {
    const blocked = busy || selecting;
    const configured = hasGiphyApiKey();
    local.disabled = blocked || count >= MAX_IMAGE_COUNT;
    input.disabled = blocked || !configured;
    submit.disabled = blocked || !configured;
    retry.disabled = blocked || searching || !configured;
    more.disabled = blocked || searching || !configured;
    more.hidden = !hasMore;
    retry.hidden = !failedRequest;
    for (const button of grid.querySelectorAll<HTMLButtonElement>('.giphy-result')) {
      button.disabled = blocked || count >= MAX_IMAGE_COUNT;
    }
    grid.setAttribute('aria-busy', String(searching || selecting));
    status.textContent = selecting ? copy().giphyImporting
      : count >= MAX_IMAGE_COUNT ? copy().imageLimitError : statusCopy(copy());
    find<HTMLElement>('.giphy-count').textContent = copy().giphyCount(count, MAX_IMAGE_COUNT);
  }

  function importError(error: unknown): StatusCopy {
    if (error instanceof FinalImageDurationError) return copy => copy.imageDurationError;
    if (error instanceof ImageImportError) {
      if (error.kind === 'animation') return copy => copy.imageAnimationError;
      if (error.kind === 'size') return copy => copy.imageImportSize(MAX_IMAGE_FILE_BYTES / 1024 / 1024);
      if (error.kind === 'dimensions') return copy => copy.imageDimensionsError;
      return copy => copy.imageDecodeError;
    }
    if (error instanceof GiphyError) {
      if (error.kind === 'size') return copy => copy.imageImportSize(MAX_IMAGE_FILE_BYTES / 1024 / 1024);
      if (error.kind === 'auth') return copy => copy.giphyAuthError;
      if (error.kind === 'rate-limit') return copy => copy.giphyRateLimitError;
      if (error.kind === 'configuration') return copy => copy.giphyNotConfigured;
    }
    return copy => copy.giphyImportError;
  }

  function searchError(error: unknown): StatusCopy {
    if (error instanceof GiphyError) {
      if (error.kind === 'auth') return copy => copy.giphyAuthError;
      if (error.kind === 'rate-limit') return copy => copy.giphyRateLimitError;
      if (error.kind === 'configuration') return copy => copy.giphyNotConfigured;
    }
    return copy => copy.giphySearchError;
  }

  function externalLink(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' ? url : null;
    } catch { return null; }
  }

  function updatePreviews() {
    for (const image of grid.querySelectorAll<HTMLImageElement>('.giphy-preview')) {
      const result = results[Number(image.dataset.resultIndex)];
      if (!result) continue;
      const source = reducedMotion.matches ? result.previewStillUrl : result.previewUrl;
      if (source && image.getAttribute('src') !== source) image.src = source;
      else if (!source) image.removeAttribute('src');
    }
  }

  function renderResults() {
    grid.replaceChildren(...results.map((result, index) => {
      const card = document.createElement('article');
      card.className = 'giphy-result-card';
      card.setAttribute('role', 'listitem');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'giphy-result';
      button.dataset.giphyId = result.id;
      label(button, copy().giphyChoose(result.title || copy().giphyUntitled));
      const image = document.createElement('img');
      image.className = 'giphy-preview';
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.dataset.resultIndex = String(index);
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
      const title = document.createElement('span');
      title.className = 'giphy-result-title';
      title.textContent = result.title || copy().giphyUntitled;
      button.append(image, title);
      button.addEventListener('click', () => { void select(result, button); });
      card.append(button);
      const attribution = document.createElement('div');
      attribution.className = 'giphy-result-attribution';
      const creatorUrl = externalLink(result.creatorUrl ?? result.pageUrl);
      if (result.creatorName && creatorUrl) {
        const creator = document.createElement('a');
        creator.className = 'giphy-creator';
        creator.href = creatorUrl;
        creator.target = '_blank';
        creator.rel = 'noopener noreferrer';
        creator.textContent = result.creatorName;
        attribution.append(creator);
      } else if (result.creatorName) {
        const creator = document.createElement('span');
        creator.textContent = result.creatorName;
        attribution.append(creator);
      }
      const pageUrl = externalLink(result.pageUrl);
      if (pageUrl) {
        const source = document.createElement('a');
        source.className = 'giphy-source';
        source.href = pageUrl;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = copy().giphySource;
        source.setAttribute('aria-label', copy().giphySourceFor(result.title || copy().giphyUntitled));
        attribution.append(source);
      }
      if (attribution.childNodes.length) card.append(attribution);
      return card;
    }));
    updatePreviews();
    updateControls();
  }

  async function load(request: SearchRequest) {
    if (!dialog.open || busy || selecting) return;
    searchController?.abort();
    const version = ++requestVersion;
    if (!hasGiphyApiKey()) {
      searching = false;
      statusCopy = copy => copy.giphyNotConfigured;
      failedRequest = null;
      updateControls();
      return;
    }
    const controller = new AbortController();
    searchController = controller;
    searching = true;
    failedRequest = null;
    statusCopy = copy => copy.giphyLoading;
    if (!request.append) {
      query = request.query;
      results = [];
      hasMore = false;
      renderResults();
    }
    updateControls();
    try {
      const response = await searchGiphy(request.query, { offset: request.offset, locale: options.getLocale(), signal: controller.signal });
      if (version !== requestVersion || controller.signal.aborted || !dialog.open) return;
      results = request.append ? [...results, ...response.results] : response.results;
      nextOffset = response.nextOffset;
      hasMore = response.hasMore;
      statusCopy = results.length === 0 ? copy => copy.giphyEmpty
        : copy => request.query.trim() ? copy.giphyResults : copy.giphyTrending;
      renderResults();
    } catch (error) {
      if (version !== requestVersion || controller.signal.aborted || !dialog.open) return;
      failedRequest = error instanceof GiphyError && (error.kind === 'auth' || error.kind === 'configuration') ? null : request;
      statusCopy = searchError(error);
    } finally {
      if (version === requestVersion) {
        searching = false;
        searchController = null;
        updateControls();
      }
    }
  }

  async function select(result: GiphyResult, button: HTMLButtonElement) {
    if (!dialog.open || busy || selecting || count >= MAX_IMAGE_COUNT) return;
    searchController?.abort();
    searchController = null;
    requestVersion++;
    searching = false;
    const version = ++selectionVersion;
    const controller = new AbortController();
    selectionController = controller;
    selecting = true;
    let failed = false;
    failedRequest = null;
    updateControls();
    try {
      await options.onSelect(result, controller.signal);
      if (version === selectionVersion && !controller.signal.aborted && dialog.open) dialog.close();
    } catch (error) {
      if (version !== selectionVersion || controller.signal.aborted || !dialog.open) return;
      statusCopy = importError(error);
      failed = true;
    } finally {
      if (version === selectionVersion) {
        selecting = false;
        selectionController = null;
        updateControls();
        if (failed) {
          const target = button.isConnected ? button
            : [...grid.querySelectorAll<HTMLButtonElement>('.giphy-result')].find(candidate => candidate.dataset.giphyId === result.id);
          if (target && !target.disabled) target.focus({ preventScroll: true });
        }
      }
    }
  }

  function updateLocale() {
    const locale = options.getLocale();
    if (locale === lastLocale) {
      updateControls();
      return;
    }
    lastLocale = locale;
    const text = copy();
    dialog.lang = locale;
    find<HTMLElement>('#final-media-title').textContent = text.helpPhotosTitle;
    find<HTMLElement>('.giphy-local-button > span').textContent = text.giphyLocal;
    find<HTMLElement>('#giphy-search-title').textContent = text.giphySearchTitle;
    find<HTMLLabelElement>('label[for="giphy-search-query"]').textContent = text.giphySearchLabel;
    find<HTMLElement>('.giphy-network-note').textContent = text.giphyNetworkNote;
    const brand = find<HTMLAnchorElement>('.giphy-brand');
    brand.setAttribute('aria-label', text.giphyPoweredBy);
    brand.querySelector<HTMLImageElement>('img')!.alt = text.giphyPoweredBy;
    input.placeholder = text.giphySearchPlaceholder;
    submit.textContent = text.giphySearch;
    retry.textContent = text.giphyRetry;
    more.textContent = text.giphyMore;
    label(close, text.giphyClose);
    label(local, text.giphyLocal);
    renderResults();
  }

  function cancelPending() {
    requestVersion++;
    selectionVersion++;
    searchController?.abort();
    selectionController?.abort();
    searchController = selectionController = null;
    searching = selecting = false;
  }

  function closePicker() {
    cancelPending();
    dialog.close();
  }

  close.addEventListener('click', closePicker);
  dialog.addEventListener('cancel', cancelPending);
  local.addEventListener('click', () => {
    if (local.disabled) return;
    closePicker();
    options.onLocal();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submit.disabled) return;
    void load({ query: input.value, offset: 0, append: false });
  });
  more.addEventListener('click', () => {
    if (!more.disabled && hasMore) void load({ query, offset: nextOffset, append: true });
  });
  retry.addEventListener('click', () => {
    if (!retry.disabled && failedRequest) void load(failedRequest);
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePicker();
  });
  dialog.addEventListener('close', () => {
    cancelPending();
    failedRequest = null;
    results = [];
    hasMore = false;
    renderResults();
    pendingFocus = opener;
    opener = null;
    restoreFocus();
  });
  reducedMotion.addEventListener('change', updatePreviews);
  updateLocale();

  return {
    open(target: HTMLElement) {
      if (dialog.open) return;
      pendingFocus = null;
      opener = target;
      updateLocale();
      dialog.showModal();
      (hasGiphyApiKey() ? input : local).focus({ preventScroll: true });
      void load({ query, offset: 0, append: false });
    },
    setBusy(value: boolean) {
      busy = value;
      updateControls();
      if (!busy) restoreFocus();
    },
    setCount(value: number) { count = Math.max(0, value); updateControls(); },
    updateLocale,
  };
}
