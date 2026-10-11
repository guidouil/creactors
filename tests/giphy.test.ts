import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_FILE_BYTES } from '../src/image/types';

let giphy: typeof import('../src/image/giphy');
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function gif(id: string, images: Record<string, unknown> = {}) {
  return { type: 'gif', id, title: `${id} GIF`, url: `https://giphy.com/gifs/${id}?ref=a%2Bb`,
    images: {
      original: { url: `https://media0.giphy.com/media/${id}/giphy.gif?cid=original%2Bkey&rid=giphy.gif`, size: '4000000', width: '480', height: '320' },
      fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif`, webp: `https://media1.giphy.com/media/${id}/200w.webp?cid=grid%2Bkey`, size: '500000', width: '200', height: '133' },
      fixed_width_still: { url: `https://media2.giphy.com/media/${id}/200w_s.gif?cid=still%2Bkey` },
      ...images,
    } };
}

function page(data: unknown[] = [gif('one')], pagination = { offset: 0, count: data.length, total_count: 24 }) {
  return new Response(JSON.stringify({ data, pagination, meta: { status: 200, msg: 'OK', response_id: 'test-response' } }),
    { headers: { 'content-type': 'application/json' } });
}

function result() {
  return { id: 'one', title: 'One GIF', previewUrl: 'https://media.giphy.com/media/one/200.webp',
    previewStillUrl: 'https://media.giphy.com/media/one/200_s.gif', pageUrl: 'https://giphy.com/gifs/one',
    gifUrl: 'https://media1.giphy.com/media/one/giphy.gif?cid=signed%2Bkey&rid=giphy.gif' };
}

/** One authored red pixel, including explicit LZW clear/end codes. */
const validGIF = Uint8Array.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0,
  0, 0, 0, 255, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 76, 1, 0, 59]);

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_GIPHY_API_KEY', '  project-key  ');
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  giphy = await import('../src/image/giphy');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('GIPHY SDK search', () => {
  it('performs no requests at import and rejects an absent key without a demo fallback', async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    expect(giphy.hasGiphyApiKey()).toBe(true);
    vi.stubEnv('VITE_GIPHY_API_KEY', ' \n ');
    expect(giphy.hasGiphyApiKey()).toBe(false);
    await expect(giphy.searchGiphy('hello', { offset: 0, locale: 'en' })).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses SDK trending for an empty query with PG rating and twelve results per page', async () => {
    fetchMock.mockResolvedValueOnce(page());
    await giphy.searchGiphy('  ', { offset: 12, locale: 'fr' });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.giphy.com/v1/gifs/trending');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ api_key: 'project-key', rating: 'pg', limit: '12', offset: '12' });
    expect(url.searchParams.has('q')).toBe(false);
  });

  it('passes the exact typed search phrase, locale and pagination through the SDK', async () => {
    fetchMock.mockResolvedValueOnce(page());
    const query = '  @art #créons + oui!?  ';
    await giphy.searchGiphy(query, { offset: 24, locale: 'fr' });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/v1/gifs/search');
    expect(url.searchParams.get('q')).toBe(query);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ lang: 'fr', offset: '24', limit: '12', rating: 'pg' });
  });

  it('keeps API result order and advances by API count even after filtering invalid URLs', async () => {
    fetchMock.mockResolvedValueOnce(page([gif('z'), { ...gif('unsafe'), url: 'https://giphy.com.evil.test/gifs/unsafe' }, gif('a')],
      { offset: 12, count: 3, total_count: 16 }));
    const found = await giphy.searchGiphy('ordered', { offset: 12, locale: 'en' });
    expect(found.results.map(item => item.id)).toEqual(['z', 'a']);
    expect(found).toMatchObject({ nextOffset: 15, hasMore: true });
    expect(found.results[0]).toMatchObject({
      previewUrl: 'https://media1.giphy.com/media/z/200w.webp?cid=grid%2Bkey',
      previewStillUrl: 'https://media2.giphy.com/media/z/200w_s.gif?cid=still%2Bkey',
      gifUrl: 'https://media0.giphy.com/media/z/giphy.gif?cid=original%2Bkey&rid=giphy.gif',
      pageUrl: 'https://giphy.com/gifs/z?ref=a%2Bb',
    });
  });

  it('selects high quality below 5MiB, falls back below 16MiB and excludes unusable downloads', async () => {
    const original = (size: number) => ({ url: 'https://media.giphy.com/media/original/giphy.gif', width: '480', height: '320', size: String(size) });
    fetchMock.mockResolvedValueOnce(page([
      gif('preferred', { original: original(8 * 1024 * 1024), downsized_medium:
        { url: 'https://media.giphy.com/media/medium/giphy.gif?key=a%2Fb', width: '400', height: '266', size: '4500000' } }),
      gif('fallback', { original: original(8 * 1024 * 1024), fixed_width: { webp: 'https://media.giphy.com/media/fallback/200w.webp' } }),
      gif('oversized', { original: original(MAX_IMAGE_FILE_BYTES + 1), fixed_width: { webp: 'https://media.giphy.com/media/oversized/200w.webp' } }),
      gif('unknown-size', { original: { ...original(1), size: undefined }, fixed_width: { webp: 'https://media.giphy.com/media/unknown/200w.webp' } }),
    ]));
    const found = await giphy.searchGiphy('quality', { offset: 0, locale: 'en' });
    expect(found.results.map(item => item.id)).toEqual(['preferred', 'fallback']);
    expect(found.results[0]!.gifUrl).toBe('https://media.giphy.com/media/medium/giphy.gif?key=a%2Fb');
    expect(found.results[1]!.gifUrl).toBe('https://media.giphy.com/media/original/giphy.gif');
  });

  it('falls back to animated GIF previews and carries safe creator attribution', async () => {
    fetchMock.mockResolvedValueOnce(page([
      { ...gif('creator', { fixed_width: { url: 'https://giphy.com/media/creator/200.gif', size: '50', width: '200', height: '100' } }),
        user: { display_name: 'An artist', username: 'artist', profile_url: 'https://giphy.com/artist?ref=origin%2Bkey' } },
      { ...gif('source'), source: 'http://artist.example/work?ref=a%2Bb' },
      { ...gif('invalid-source'), source: 'javascript:alert(1)' },
    ]));
    const found = await giphy.searchGiphy('attribution', { offset: 0, locale: 'en' });
    expect(found.results[0]).toMatchObject({ previewUrl: 'https://giphy.com/media/creator/200.gif',
      creatorName: 'An artist', creatorUrl: 'https://giphy.com/artist?ref=origin%2Bkey' });
    expect(found.results[1]!.creatorUrl).toBe('http://artist.example/work?ref=a%2Bb');
    expect(found.results[2]!.creatorUrl).toBe(found.results[2]!.pageUrl);
  });

  it('rejects credentials, deceptive hosts, non-HTTPS media and non-GIF downloads', async () => {
    const urls = ['http://media.giphy.com/a.gif', 'https://giphy.com.evil.test/a.gif', 'https://evilgiphy.com/a.gif',
      'https://user:pass@media.giphy.com/a.gif', 'https://media.giphy.com:8080/a.gif', 'https://media.giphy.com/a.mp4'];
    fetchMock.mockResolvedValueOnce(page(urls.map((url, index) => gif(`bad-${index}`,
      { original: { url, size: '1' }, fixed_width: { webp: 'https://media.giphy.com/a.webp' } }))));
    expect((await giphy.searchGiphy('urls', { offset: 0, locale: 'en' })).results).toEqual([]);
  });

  it('ends pagination at empty pages, total count and the official endpoint offset limit', async () => {
    fetchMock.mockResolvedValueOnce(page([], { offset: 24, count: 0, total_count: 100 }));
    expect(await giphy.searchGiphy('empty', { offset: 24, locale: 'en' })).toMatchObject({ nextOffset: 24, hasMore: false });
    fetchMock.mockResolvedValueOnce(page([gif('last')], { offset: 11, count: 1, total_count: 12 }));
    expect(await giphy.searchGiphy('last', { offset: 11, locale: 'en' })).toMatchObject({ nextOffset: 12, hasMore: false });
    fetchMock.mockResolvedValueOnce(page([gif('limit')], { offset: 499, count: 1, total_count: 1000 }));
    expect(await giphy.searchGiphy('', { offset: 499, locale: 'en' })).toMatchObject({ nextOffset: 500, hasMore: false });
  });

  it.each([[401, 'auth'], [403, 'auth'], [429, 'rate-limit'], [500, 'network']] as const)
  ('maps SDK HTTP %i errors to %s', async (status, kind) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ meta: { msg: 'Service error' } }), { status }));
    await expect(giphy.searchGiphy(`error-${status}`, { offset: 0, locale: 'en' })).rejects.toMatchObject({ kind });
  });

  it('abandons waiting on SDK searches promptly, including abort before requesting', async () => {
    const before = new AbortController(); before.abort();
    await expect(giphy.searchGiphy('before', { offset: 0, locale: 'en', signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const controller = new AbortController();
    const pending = giphy.searchGiphy('cancel', { offset: 0, locale: 'en', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds waiting for unresponsive SDK searches', async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    const check = expect(giphy.searchGiphy('timeout', { offset: 0, locale: 'en' })).rejects.toMatchObject({ kind: 'network' });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded direct GIPHY download', () => {
  it('retains the entire URL, reads a stream without content-length and creates a local GIF File', async () => {
    fetchMock.mockResolvedValueOnce(new Response(validGIF));
    const file = await giphy.downloadGiphyGif(result(), new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledWith(result().gifUrl, expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'image/gif' }, signal: expect.any(AbortSignal) }));
    expect(file.name).toBe('one.gif');
    expect(file.type).toBe('image/gif');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(validGIF);
  });

  it('rejects an oversized content-length and cancels the unread body', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { 'content-length': String(MAX_IMAGE_FILE_BYTES + 1) } }));
    await expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ kind: 'size' });
    expect(cancel).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
  });

  it('enforces the byte limit while streaming despite a missing or false content-length', async () => {
    for (const length of [undefined, '1']) {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMAGE_FILE_BYTES));
        controller.enqueue(Uint8Array.of(0));
      }, cancel });
      fetchMock.mockResolvedValueOnce(new Response(body, { headers: length ? { 'content-length': length } : {} }));
      await expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ kind: 'size' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    }
  });

  it('accepts exactly 16MiB after validating GIF blocks and LZW', async () => {
    const bytes = new Uint8Array(MAX_IMAGE_FILE_BYTES); bytes.set(validGIF);
    fetchMock.mockResolvedValueOnce(new Response(bytes));
    expect((await giphy.downloadGiphyGif(result(), new AbortController().signal)).size).toBe(MAX_IMAGE_FILE_BYTES);
  });

  it('rejects invalid/truncated GIFs and unsafe download URLs', async () => {
    for (const bytes of [new TextEncoder().encode('<html>oops</html>'), validGIF.slice(0, -1)]) {
      fetchMock.mockResolvedValueOnce(new Response(bytes));
      await expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ kind: 'download' });
    }
    const count = fetchMock.mock.calls.length;
    await expect(giphy.downloadGiphyGif({ ...result(), gifUrl: 'https://evil.test/giphy.gif' }, new AbortController().signal))
      .rejects.toMatchObject({ kind: 'download' });
    expect(fetchMock.mock.calls).toHaveLength(count);
  });

  it('preserves GIF dimension and animation-limit errors for the import UI', async () => {
    const wide = validGIF.slice(); wide[6] = 1; wide[7] = 16; // 4097px exceeds the source edge limit.
    const long = Uint8Array.from([...validGIF.slice(0, 19), 0x21, 0xf9, 4, 0, 0xb9, 0x0b, 0, 0, ...validGIF.slice(19)]);
    for (const [bytes, kind] of [[wide, 'dimensions'], [long, 'animation']] as const) {
      fetchMock.mockResolvedValueOnce(new Response(bytes));
      await expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ name: 'ImageImportError', kind });
    }
  });

  it('cancels a pending reader and releases its lock on caller abort', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(validGIF.slice(0, 6)); }, cancel });
    fetchMock.mockResolvedValueOnce(new Response(body));
    const controller = new AbortController();
    const pending = giphy.downloadGiphyGif(result(), controller.signal);
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect((fetchMock.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
  });

  it('does not fetch an already aborted download', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(giphy.downloadGiphyGif(result(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out a pending reader after fifteen seconds and clears the timer', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    fetchMock.mockResolvedValueOnce(new Response(body));
    const check = expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ kind: 'download' });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([[401, 'auth'], [429, 'rate-limit'], [500, 'download']] as const)
  ('maps download HTTP %i to %s and cancels its body', async (status, kind) => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status }));
    await expect(giphy.downloadGiphyGif(result(), new AbortController().signal)).rejects.toMatchObject({ kind });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
