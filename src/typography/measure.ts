import { Box2, Vector2 } from 'three';
import { DEFAULT_FONT_ID, fontKerning, getDisplayFont, getOutlineFont } from './fonts';
import type { EmphasisScores, TextAnalysis, TextGroup } from '../text/director';
import { graphemes, isEmojiCluster } from '../text/graphemes';
import { EMOJI_ADVANCE } from './emoji';
import { findPortal, type PortalCandidate } from './portals';

export interface GlyphCounter {
  character: string;
  /** Glyph-local em coordinates, from the actual closed outline. */
  bounds: readonly [number, number, number, number];
  area: number;
}

export interface MeasuredGroup {
  fontId: string;
  group: TextGroup;
  id: string;
  displayText: string;
  /** Tight outline extents in font em units, at fontSize=1. */
  width: number;
  height: number;
  /** Visible glyph footprint, useful for final composition spacing. */
  inkHeight: number;
  lineWidths: readonly number[];
  lineCount: number;
  capHeight: number;
  counters: readonly GlyphCounter[];
  portal: PortalCandidate | null;
  scores: EmphasisScores;
}

interface MeasuredGlyph { advance: number; bounds: readonly [number, number, number, number]; counters: readonly GlyphCounter[] }
const glyphCache = new Map<string, MeasuredGlyph>();
const portalCache = new Map<string, PortalCandidate | null>();

function measureGlyph(cluster: string, fontId: string): MeasuredGlyph {
  if (isEmojiCluster(cluster)) return { advance: EMOJI_ADVANCE, bounds: [0, -0.05, EMOJI_ADVANCE, 0.9], counters: [] };
  // NFC is a measurement key only: source and display strings remain untouched.
  const character = cluster.normalize('NFC');
  const key = `${fontId}\0${character}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const { glyphs, resolution } = getDisplayFont(fontId).typeface;
  const font = getOutlineFont(fontId);
  const glyph = glyphs[character] ?? glyphs['?']!;
  const shapes = font.generateShapes(glyphs[character] ? character : '?', 1);
  const bounds = new Box2();
  const counters: GlyphCounter[] = [];
  for (const shape of shapes) {
    for (const point of shape.getPoints(12)) bounds.expandByPoint(point);
    for (const hole of shape.holes) {
      const points = hole.getPoints(16);
      if (points.length < 3 || points[0]!.distanceTo(points[points.length - 1]!) > 0.002) continue;
      const box = new Box2().setFromPoints(points);
      let twiceArea = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!; const b = points[(i + 1) % points.length]!;
        twiceArea += a.x * b.y - b.x * a.y;
      }
      const area = Math.abs(twiceArea) / 2;
      if (area > 0.0001) counters.push({ character, bounds: [box.min.x, box.min.y, box.max.x, box.max.y], area });
    }
  }
  const result: MeasuredGlyph = {
    advance: glyph.ha / resolution,
    bounds: bounds.isEmpty() ? [0, 0, 0, 0] : [bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y], counters,
  };
  glyphCache.set(key, result);
  return result;
}

function kern(previous: string | undefined, current: string, fontId: string): number {
  if (!previous || isEmojiCluster(previous) || isEmojiCluster(current)) return 0;
  return fontKerning(previous, current, fontId);
}

export function measureLine(text: string, fontId = DEFAULT_FONT_ID): { width: number; minY: number; maxY: number; counters: readonly GlyphCounter[] } {
  let cursor = 0;
  let previous: string | undefined;
  const bounds = new Box2();
  const counters: GlyphCounter[] = [];
  for (const cluster of graphemes(text)) {
    const glyph = measureGlyph(cluster, fontId);
    cursor += kern(previous, cluster, fontId);
    if (!/\s/u.test(cluster)) {
      bounds.expandByPoint(new Vector2(cursor + glyph.bounds[0], glyph.bounds[1]));
      bounds.expandByPoint(new Vector2(cursor + glyph.bounds[2], glyph.bounds[3]));
    }
    counters.push(...glyph.counters);
    cursor += glyph.advance;
    previous = cluster;
  }
  return { width: Math.max(cursor, bounds.isEmpty() ? 0 : bounds.max.x - Math.min(0, bounds.min.x)), minY: bounds.isEmpty() ? 0 : bounds.min.y, maxY: bounds.isEmpty() ? 0.7 : bounds.max.y, counters };
}

function wrap(text: string, fontId: string, maxWidth = 6): string[] {
  const measure = (value: string) => measureLine(value, fontId);
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (measure(word).width > maxWidth) {
      if (current) { lines.push(current); current = ''; }
      // Keep wide words whole; the director reduces their size to fit.
      lines.push(word);
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate).width > maxWidth) { lines.push(current); current = word; }
    else current = candidate;
  }
  if (current) lines.push(current);
  // Two shorter balanced lines often give short phrases far more visual weight.
  if (lines.length === 1 && words.length >= 2 && words.length <= 4 && measure(lines[0]!).width > 3.1) {
    let best: readonly [string, string] | undefined;
    let bestDifference = Infinity;
    for (let at = 1; at < words.length; at++) {
      const a = words.slice(0, at).join(' '); const b = words.slice(at).join(' ');
      const difference = Math.abs(measure(a).width - measure(b).width);
      if (difference < bestDifference) { best = [a, b]; bestDifference = difference; }
    }
    if (best) return [...best];
  }
  return lines;
}

export function measureGroups(analysis: TextAnalysis, fontId = DEFAULT_FONT_ID): MeasuredGroup[] {
  const { metadata } = getDisplayFont(fontId);
  return analysis.groups.map(group => {
    const lines = wrap(group.text, fontId);
    const measured = lines.map(line => measureLine(line, fontId));
    const width = Math.max(...measured.map(line => line.width), 0.2);
    // Troika's block includes font ascender/descender, beyond tight outlines.
    // Use the larger bounds so both SDF and extrusion fit the same camera rules.
    const height = Math.max((metadata.ascender - metadata.descender) / metadata.unitsPerEm, measured[0]!.maxY - measured[measured.length - 1]!.minY) + (lines.length - 1) * 1.05;
    const inkHeight = Math.max(0.45, measured[0]!.maxY - measured[measured.length - 1]!.minY + (lines.length - 1) * 1.05);
    const counters = measured.flatMap(line => [...line.counters]);
    const balance = lines.length <= 1 ? 1 : Math.min(...measured.map(line => line.width)) / width;
    const geometryPotential = Math.min(1, counters.reduce((sum, counter) => sum + Math.min(counter.area * 10, 0.25), 0));
    const displayText = lines.join('\n');
    const key = `${fontId}\0${displayText}`;
    if (!portalCache.has(key)) portalCache.set(key, findPortal(displayText, 1, fontId));
    const portal = portalCache.get(key)!;
    return {
      fontId, group, id: group.id, displayText, width, height, inkHeight,
      lineWidths: measured.map(line => line.width), lineCount: lines.length, capHeight: metadata.capHeight / metadata.unitsPerEm,
      counters, portal,
      scores: {
        ...group.scores,
        visual: Math.min(1, balance * 0.35 + geometryPotential * 0.35 + Math.min(1, width / 3) * 0.3),
        readability: Math.max(0.1, group.scores.readability - Math.max(0, lines.length - 2) * 0.08),
        composition: Math.min(1, balance * 0.6 + 0.4 * Math.min(1, 2 / Math.max(0.3, width / height))),
      },
    };
  });
}
