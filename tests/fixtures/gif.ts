interface GifPatch {
  left: number;
  top: number;
  width: number;
  height: number;
  color: number;
  delay: number;
  disposal?: 1 | 2 | 3;
  transparentLeft?: boolean;
}

/** Tiny GIF89a fixtures with explicit delays and disposal, without a runtime encoder. */
function gif(width: number, height: number, patches: readonly GifPatch[]): Buffer {
  const bytes: number[] = [...Buffer.from('GIF89a')];
  const word = (value: number) => bytes.push(value & 255, value >> 8);
  word(width); word(height);
  // Four global entries: transparent black, red, green, blue.
  bytes.push(0xf1, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255);
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  for (const patch of patches) {
    bytes.push(0x21, 0xf9, 4, ((patch.disposal ?? 1) << 2) | 1);
    word(patch.delay); bytes.push(0, 0);
    bytes.push(0x2c); word(patch.left); word(patch.top); word(patch.width); word(patch.height);
    bytes.push(0, 2);
    // A clear before each literal keeps the LZW code width fixed at three bits.
    const packed: number[] = [];
    let bits = 0, count = 0;
    const code = (value: number) => {
      bits |= value << count; count += 3;
      while (count >= 8) { packed.push(bits & 255); bits >>= 8; count -= 8; }
    };
    for (let pixel = 0; pixel < patch.width * patch.height; pixel++) {
      code(4);
      code(patch.transparentLeft && pixel % patch.width < patch.width / 2 ? 0 : patch.color);
    }
    code(5);
    if (count) packed.push(bits & 255);
    for (let start = 0; start < packed.length; start += 255) {
      const block = packed.slice(start, start + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/** Full red → green → blue frames, with 200/300/500 ms delays. */
export function colorCycleGifFixture(): Buffer {
  return gif(64, 64, [1, 2, 3].map((color, index) => ({
    left: 0, top: 0, width: 64, height: 64, color, delay: [20, 30, 50][index]!,
  })));
}

/** A static GIF's frame delay must not extend the final image hold. */
export function singleFrameGifFixture(): Buffer {
  return gif(64, 64, [{ left: 0, top: 0, width: 64, height: 64, color: 1, delay: 3000 }]);
}

/** Restore-previous removes green; restore-background clears the blue quadrant. */
export function disposalGifFixture(): Buffer {
  return gif(32, 32, [
    { left: 0, top: 0, width: 32, height: 32, color: 1, delay: 20 },
    { left: 0, top: 0, width: 16, height: 16, color: 2, delay: 30, disposal: 3 },
    { left: 16, top: 16, width: 16, height: 16, color: 3, delay: 40, disposal: 2 },
    { left: 0, top: 16, width: 16, height: 16, color: 2, delay: 50, transparentLeft: true },
  ]);
}
