import { Box2, Vector2 } from 'three';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import typeface from '../../assets/generated/barlow-condensed-black.typeface.json';
import metadata from '../../assets/generated/barlow-condensed-black.coverage.json';
import type { EmphasisScores, TextAnalysis, TextGroup } from '../text/director';
import { graphemes, isEmojiCluster } from '../text/graphemes';
import { EMOJI_ADVANCE } from './emoji';
import { findPortal, type PortalCandidate } from './portals';

interface GlyphData { ha: number; x_min: number; x_max: number; o: string }
const glyphs = typeface.glyphs as Record<string, GlyphData>;
const kerning = metadata.kerningPairs as Record<string, number>;
const resolution = typeface.resolution;
const font: Font = new FontLoader().parse({ ...typeface, original_font_information: { family: typeface.familyName } });

export interface GlyphCounter {
  character: string;
  /** Glyph-local em coordinates, from the actual closed outline. */
  bounds: readonly [number, number, number, number];
  area: number;
}

export interface MeasuredGroup {
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

function measureGlyph(cluster: string): MeasuredGlyph {
  if (isEmojiCluster(cluster)) return { advance: EMOJI_ADVANCE, bounds: [0, -0.05, EMOJI_ADVANCE, 0.9], counters: [] };
  // NFC is a measurement key only: source and display strings remain untouched.
  const character = cluster.normalize('NFC');
  const cached = glyphCache.get(character);
  if (cached) return cached;
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
  glyphCache.set(character, result);
  return result;
}

function kern(previous: string | undefined, current: string): number {
  if (!previous || isEmojiCluster(previous) || isEmojiCluster(current)) return 0;
  return (kerning[`${previous.normalize('NFC').codePointAt(0)},${current.normalize('NFC').codePointAt(0)}`] ?? 0) / metadata.unitsPerEm;
}

export function measureLine(text: string): { width: number; minY: number; maxY: number; counters: readonly GlyphCounter[] } {
  let cursor = 0;
  let previous: string | undefined;
  const bounds = new Box2();
  const counters: GlyphCounter[] = [];
  for (const cluster of graphemes(text)) {
    const glyph = measureGlyph(cluster);
    cursor += kern(previous, cluster);
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

function wrap(text: string, maxWidth = 6): string[] {
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (measureLine(word).width > maxWidth) {
      if (current) { lines.push(current); current = ''; }
      let partial = '';
      for (const cluster of graphemes(word)) {
        if (partial && measureLine(partial + cluster).width > maxWidth) { lines.push(partial); partial = ''; }
        partial += cluster;
      }
      current = partial;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureLine(candidate).width > maxWidth) { lines.push(current); current = word; }
    else current = candidate;
  }
  if (current) lines.push(current);
  // Two shorter balanced lines often give short phrases far more visual weight.
  if (lines.length === 1 && words.length >= 2 && words.length <= 4 && measureLine(lines[0]!).width > 3.1) {
    let best: readonly [string, string] | undefined;
    let bestDifference = Infinity;
    for (let at = 1; at < words.length; at++) {
      const a = words.slice(0, at).join(' '); const b = words.slice(at).join(' ');
      const difference = Math.abs(measureLine(a).width - measureLine(b).width);
      if (difference < bestDifference) { best = [a, b]; bestDifference = difference; }
    }
    if (best) return [...best];
  }
  return lines;
}

export function measureGroups(analysis: TextAnalysis): MeasuredGroup[] {
  return analysis.groups.map(group => {
    const lines = wrap(group.text);
    const measured = lines.map(measureLine);
    const width = Math.max(...measured.map(line => line.width), 0.2);
    // Troika's block includes font ascender/descender, beyond tight outlines.
    // Use the larger bounds so both SDF and extrusion fit the same camera rules.
    const height = Math.max((metadata.ascender - metadata.descender) / metadata.unitsPerEm, measured[0]!.maxY - measured[measured.length - 1]!.minY) + (lines.length - 1) * 1.05;
    const inkHeight = Math.max(0.45, measured[0]!.maxY - measured[measured.length - 1]!.minY + (lines.length - 1) * 1.05);
    const counters = measured.flatMap(line => [...line.counters]);
    const balance = lines.length <= 1 ? 1 : Math.min(...measured.map(line => line.width)) / width;
    const geometryPotential = Math.min(1, counters.reduce((sum, counter) => sum + Math.min(counter.area * 10, 0.25), 0));
    const displayText = lines.join('\n');
    if (!portalCache.has(displayText)) portalCache.set(displayText, findPortal(displayText, 1));
    const portal = portalCache.get(displayText)!;
    return {
      group, id: group.id, displayText, width, height, inkHeight,
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
