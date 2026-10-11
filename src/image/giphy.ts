import { GiphyFetch } from '@giphy/js-fetch-api';
import { inspectGIF } from './gif';
import { ImageImportError, MAX_IMAGE_FILE_BYTES } from './types';

export interface GiphyResult {
  id: string;
  title: string;
  previewUrl: string;
  previewStillUrl: string;
  pageUrl: string;
  gifUrl: string;
  creatorName?: string;
  creatorUrl?: string;
}

export class GiphyError extends Error {
  constructor(readonly kind: 'configuration' | 'network' | 'rate-limit' | 'auth' | 'download' | 'size') {
    super(`GIPHY failed: ${kind}`);
    this.name = 'GiphyError';
  }
}

const PAGE_SIZE = 12;
const TIMEOUT_MS = 15_000;
const PREFERRED_GIF_BYTES = 5 * 1024 * 1024;

function apiKey(): string {
  const value = import.meta.env.VITE_GIPHY_API_KEY;
  return typeof value === 'string' ? value.trim() : '';
}

export function hasGiphyApiKey(): boolean { return apiKey().length > 0; }

/** Inspect URLs without rebuilding them: signed query strings must stay intact. */
function safeUrl(value: unknown, giphyOnly = true): string | undefined {
  if (typeof value !== 'string' || !value || value !== value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return undefined;
    if (giphyOnly) {
      if (url.protocol !== 'https:' || !(url.hostname === 'giphy.com' || url.hostname.endsWith('.giphy.com'))) return undefined;
    } else if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return value;
  } catch { return undefined; }
}

function mediaUrl(value: unknown, format: 'gif' | 'webp'): string | undefined {
  const url = safeUrl(value);
  return url && new URL(url).pathname.toLowerCase().endsWith(`.${format}`) ? url : undefined;
}

type Rendition = { url?: unknown; webp?: unknown; size?: unknown; width?: unknown; height?: unknown };
const fullGifRenditions = ['original', 'downsized_large', 'downsized_medium', 'downsized',
  'fixed_width', 'fixed_height', 'fixed_width_small', 'fixed_height_small'] as const;

function toResult(value: unknown): GiphyResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const gif = value as Record<string, unknown>;
  if (gif.type !== 'gif' || (typeof gif.id !== 'string' && typeof gif.id !== 'number')) return undefined;
  const id = String(gif.id);
  const pageUrl = safeUrl(gif.url);
  const images = gif.images as Record<string, Rendition> | undefined;
  if (!id || !pageUrl || !images || typeof images !== 'object') return undefined;
  const preview = ['fixed_width', 'fixed_height', 'fixed_width_small', 'fixed_height_small'];
  const previewUrl = preview.map(key => mediaUrl(images[key]?.webp, 'webp')).find(Boolean)
    ?? preview.map(key => mediaUrl(images[key]?.url, 'gif')).find(Boolean);
  const previewStillUrl = ['fixed_width_still', 'fixed_height_still', 'original_still', 'downsized_still']
    .map(key => mediaUrl(images[key]?.url, 'gif')).find(Boolean);
  const candidates = fullGifRenditions.flatMap((key, priority) => {
    const image = images[key];
    const url = mediaUrl(image?.url, 'gif');
    const size = Number(image?.size);
    if (!url || !Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_FILE_BYTES) return [];
    const width = Number(image?.width), height = Number(image?.height);
    const area = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width * height : 0;
    return [{ url, size, area, priority }];
  });
  // Prefer spatial quality within the 5MiB tier; never use trimmed/downsampled
  // preview renditions for the film. Actual bytes are bounded again below.
  const preferred = candidates.filter(image => image.size <= PREFERRED_GIF_BYTES);
  const choice = (preferred.length ? preferred : candidates)
    .sort((a, b) => b.area - a.area || a.priority - b.priority)[0];
  if (!previewUrl || !previewStillUrl || !choice) return undefined;
  const user = gif.user && typeof gif.user === 'object' ? gif.user as Record<string, unknown> : undefined;
  const creatorName = [user?.display_name, user?.username, gif.username]
    .find((name): name is string => typeof name === 'string' && name.trim().length > 0);
  const creatorUrl = safeUrl(user?.profile_url, false) ?? safeUrl(gif.source, false) ?? pageUrl;
  return { id, title: typeof gif.title === 'string' ? gif.title : '', previewUrl, previewStillUrl,
    pageUrl, gifUrl: choice.url, ...(creatorName ? { creatorName } : {}), creatorUrl };
}

function abortError(): DOMException { return new DOMException('GIPHY request cancelled', 'AbortError'); }

/** Stop waiting promptly even when the SDK cannot abort its internal fetch. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function responseError(status: number, fallback: 'network' | 'download'): GiphyError {
  return new GiphyError(status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'auth' : fallback);
}

export async function searchGiphy(query: string, options: { offset: number; locale: 'fr' | 'en'; signal?: AbortSignal }):
Promise<{ results: GiphyResult[]; nextOffset: number; hasMore: boolean }> {
  const key = apiKey();
  if (!key) throw new GiphyError('configuration');
  if (options.signal?.aborted) throw abortError();
  const trending = query.trim().length === 0;
  const maxOffset = trending ? 499 : 4999;
  const offset = Number.isSafeInteger(options.offset) ? Math.max(0, Math.min(options.offset, maxOffset)) : 0;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  try {
    // Construction and requests are deliberately lazy: importing this module
    // never calls GIPHY. The SDK keeps its response cache only in memory.
    const sdk = new GiphyFetch(key);
    const page = await abortable(trending ? sdk.trending({ limit: PAGE_SIZE, offset, rating: 'pg' })
      : sdk.search(query, { limit: PAGE_SIZE, offset, rating: 'pg', lang: options.locale }), controller.signal);
    if (!Array.isArray(page.data) || !page.pagination) throw new GiphyError('network');
    if (page.meta?.status && page.meta.status !== 200) throw responseError(page.meta.status, 'network');
    const count = Number.isSafeInteger(page.pagination.count) && page.pagination.count >= 0
      ? page.pagination.count : page.data.length;
    const pageOffset = Number.isSafeInteger(page.pagination.offset) && page.pagination.offset >= offset
      ? page.pagination.offset : offset;
    const nextOffset = pageOffset + count;
    const total = page.pagination.total_count;
    return { results: page.data.flatMap(gif => { const result = toResult(gif); return result ? [result] : []; }),
      nextOffset, hasMore: count > 0 && nextOffset <= maxOffset && Number.isFinite(total) && nextOffset < total };
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    if (timedOut) throw new GiphyError('network');
    if (error instanceof GiphyError) throw error;
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
    throw responseError(status, 'network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** Download a bounded local GIF, retaining the exact CDN URL and its query. */
export async function downloadGiphyGif(result: GiphyResult, signal: AbortSignal): Promise<File> {
  const url = mediaUrl(result.gifUrl, 'gif');
  if (!url) throw new GiphyError('download');
  if (signal.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let complete = false;
  try {
    response = await abortable(fetch(url, { method: 'GET', signal: controller.signal, credentials: 'omit',
      cache: 'no-store', headers: { Accept: 'image/gif' } }), controller.signal);
    if (response.url && !safeUrl(response.url)) throw new GiphyError('download');
    if (!response.ok) throw responseError(response.status, 'download');
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_IMAGE_FILE_BYTES) throw new GiphyError('size');
    if (!response.body) throw new GiphyError('download');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await abortable(reader.read(), controller.signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_FILE_BYTES) throw new GiphyError('size');
      chunks.push(chunk.value);
    }
    if (controller.signal.aborted) throw abortError();
    const bytes = new Uint8Array(size);
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
    try { inspectGIF(bytes); } catch (error) {
      if (error instanceof ImageImportError && error.kind !== 'decode') throw error;
      throw new GiphyError('download');
    }
    const name = `${result.id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'giphy'}.gif`;
    const file = new File([bytes], name, { type: 'image/gif' });
    complete = true;
    return file;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut) throw new GiphyError('download');
    if (error instanceof GiphyError || error instanceof ImageImportError) throw error;
    throw new GiphyError('network');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (!complete) {
      controller.abort();
      try { if (reader) await reader.cancel(); else await response?.body?.cancel(); } catch { /* Already aborted/closed. */ }
    }
    reader?.releaseLock();
  }
}
