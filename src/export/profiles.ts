import { canEncodeVideo, Quality, type VideoEncodingConfig } from 'mediabunny';
import type { FilmFormat } from '../scene/format';

export interface ExportProfile {
  format: 'mp4' | 'webm';
  codec: 'avc' | 'vp9' | 'vp8';
  width: 1080 | 720;
  height: 1920 | 1280 | 1080 | 720;
  bitrate: number;
  fps: 30;
}

/** A codec API being present is only the first check, never an export guarantee. */
export function isExportAvailable(): boolean {
  return globalThis.isSecureContext !== false
    && typeof globalThis.VideoEncoder !== 'undefined'
    && typeof globalThis.VideoFrame !== 'undefined';
}

/** The legacy portrait height selects quality for both film formats. */
export function candidateProfiles(preferredHeight: 1920 | 1280 = 1920, filmFormat: FilmFormat = 'vertical'): ExportProfile[] {
  const widths = preferredHeight === 1280 ? [720] as const : [1080, 720] as const;
  return (['avc', 'vp9', 'vp8'] as const).flatMap(codec => widths.map(width => ({
    format: codec === 'avc' ? 'mp4' as const : 'webm' as const,
    codec,
    width,
    height: filmFormat === 'square' ? width : width === 1080 ? 1920 as const : 1280 as const,
    bitrate: width === 1080 ? 12_000_000 : 6_000_000,
    fps: 30 as const,
  })));
}

export function encodingConfig(profile: ExportProfile): VideoEncodingConfig {
  return {
    codec: profile.codec,
    quality: new Quality({ bitrate: profile.bitrate }),
    alpha: 'discard',
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
    keyFrameInterval: 2,
    sizeChangeBehavior: 'deny',
  };
}

/** Baseline AVC avoids frame reordering; both actual film sizes are probed. */
export function nativeAvcConfig(profile: ExportProfile): VideoEncoderConfig {
  return {
    codec: profile.width === 1080 ? 'avc1.420028' : 'avc1.42001f',
    width: profile.width,
    height: profile.height,
    bitrate: profile.bitrate,
    bitrateMode: 'variable',
    framerate: profile.fps,
    alpha: 'discard',
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-hardware',
    avc: { format: 'avc' },
  };
}

export async function profileIsSupported(profile: ExportProfile): Promise<boolean> {
  if (profile.codec === 'avc') {
    return (await VideoEncoder.isConfigSupported(nativeAvcConfig(profile))).supported === true;
  }
  return canEncodeVideo(profile.codec, {
    ...encodingConfig(profile),
    width: profile.width,
    height: profile.height,
    frameRate: profile.fps,
  });
}

/** Configuration checks for UI capability hints. Export also encodes a smoke file. */
export async function detectProfiles(preferredHeight: 1920 | 1280 = 1920, filmFormat: FilmFormat = 'vertical'): Promise<ExportProfile[]> {
  if (!isExportAvailable()) return [];
  const supported: ExportProfile[] = [];
  for (const profile of candidateProfiles(preferredHeight, filmFormat)) {
    try { if (await profileIsSupported(profile)) supported.push(profile); }
    catch { /* Some browsers throw for unsupported codec options. */ }
  }
  return supported;
}
