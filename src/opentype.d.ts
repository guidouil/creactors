declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    path: { commands: PathCommand[] };
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: { length: number; get(index: number): Glyph };
    tables: {
      cmap: { glyphIndexMap: Record<string, number> };
      head: { xMin: number; yMin: number; xMax: number; yMax: number };
      post?: { underlinePosition?: number; underlineThickness?: number; italicAngle?: number };
      os2?: { sCapHeight?: number; usWeightClass?: number; fsSelection?: number };
    };
    charToGlyph(character: string): Glyph;
    getEnglishName(name: string): string | undefined;
    getKerningValue(left: Glyph, right: Glyph): number;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
