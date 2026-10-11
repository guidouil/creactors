declare module 'troika-three-text' {
  import { Mesh, ColorRepresentation, Material } from 'three';
  export class Text extends Mesh {
    text: string;
    font: string;
    fontSize: number;
    anchorX: string | number;
    anchorY: string | number;
    color: ColorRepresentation;
    sdfGlyphSize: number;
    outlineWidth: number;
    letterSpacing: number;
    lineHeight: number;
    maxWidth: number;
    textAlign: string;
    material: Material;
    textRenderInfo: { blockBounds: [number, number, number, number]; glyphBounds: Float32Array } | null;
    sync(callback: () => void): void;
    dispose(): void;
  }
  export function configureTextBuilder(config: { useWorker?: boolean; unicodeFontsURL?: string; defaultFontURL?: string }): void;
}
