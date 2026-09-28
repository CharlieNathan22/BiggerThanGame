/** Lossless PNG recompression (png.ts): smaller, and the same pixels. */

import { describe, expect, it } from "vitest";
import { decodePng, encodePng, optimisePng } from "../png.js";
import type { Pixels } from "../png.js";

/** A gradient with a little noise, so every row filter gets used somewhere. */
function image(width: number, height: number, alpha: (x: number, y: number) => number): Pixels {
  const data = Buffer.alloc(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 5) - 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, x * 3 + noise()));
      data[i + 1] = Math.max(0, Math.min(255, y * 5 + noise()));
      data[i + 2] = (x * y) & 0xff;
      data[i + 3] = alpha(x, y);
    }
  }
  return { width, height, channels: 4, data };
}

describe("encodePng and decodePng", () => {
  it("round-trip every pixel exactly", () => {
    const original = image(37, 23, (x) => (x * 7) & 0xff);
    const decoded = decodePng(encodePng(original));
    expect(decoded).toMatchObject({ width: 37, height: 23, channels: 4 });
    expect(decoded.data.equals(original.data)).toBe(true);
  });
});

describe("optimisePng", () => {
  it("drops the alpha of an opaque image and keeps every colour", () => {
    const original = image(64, 40, () => 255);
    const optimised = decodePng(optimisePng(encodePng(original)));
    expect(optimised.channels).toBe(3);
    for (let p = 0; p < 64 * 40; p++) {
      expect([...optimised.data.subarray(p * 3, p * 3 + 3)]).toEqual([
        ...original.data.subarray(p * 4, p * 4 + 3),
      ]);
    }
  });

  it("keeps the alpha of an image that has some transparency", () => {
    const original = image(16, 16, (x, y) => (x === y ? 0 : 255));
    const optimised = decodePng(optimisePng(encodePng(original)));
    expect(optimised.channels).toBe(4);
    expect(optimised.data.equals(original.data)).toBe(true);
  });

  it("never makes a file bigger", () => {
    const png = encodePng(image(50, 30, () => 255));
    expect(optimisePng(png).length).toBeLessThanOrEqual(png.length);
  });

  it("refuses something that isn't a PNG", () => {
    expect(() => decodePng(Buffer.from("GIF89a"))).toThrow("not a PNG");
  });
});
