/**
 * Lossless PNG recompression, with Node's own zlib: for `pnpm site:images`,
 * whose screenshots come out of Chrome quickly compressed.
 *
 * `optimisePng` reads an 8-bit RGB or RGBA PNG, drops the alpha channel when
 * every pixel is opaque, picks the best filter for each row (the one whose
 * bytes sum smallest, the usual heuristic) and deflates at level 9. The pixels
 * are unchanged; `decodePng` reads them back, which is how the test checks it.
 */

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Bytes per pixel: 3 (RGB) or 4 (RGBA). */
  readonly channels: 3 | 4;
  /** Row after row, no filter bytes. */
  readonly data: Buffer;
}

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function chunks(png: Buffer): Chunk[] {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const out: Chunk[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    out.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** The raw pixels of an 8-bit, non-interlaced RGB or RGBA PNG. */
export function decodePng(png: Buffer): Pixels {
  const all = chunks(png);
  const header = all.find((c) => c.type === "IHDR")?.data;
  if (header === undefined) throw new Error("PNG without IHDR");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, , , interlace] = header.subarray(8, 13);
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error("only 8-bit non-interlaced RGB or RGBA PNGs");
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(all.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter!];
      if (predictor === undefined) throw new Error(`unknown PNG filter ${filter}`);
      data[y * stride + x] = (line[x]! + predictor) & 0xff;
    }
  }
  return { width, height, channels, data };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Pixels as a PNG, each row with its best filter, deflated at level 9. */
export function encodePng(pixels: Pixels): Buffer {
  const { width, height, channels, data } = pixels;
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    let best = -1;
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? data[y * stride + x - channels]! : 0;
        const b = y > 0 ? data[(y - 1) * stride + x]! : 0;
        const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
        const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]!;
        const value = (data[y * stride + x]! - predictor) & 0xff;
        candidate[x] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
        out[y * (stride + 1)] = filter;
        candidate.copy(out, y * (stride + 1) + 1);
      }
    }
    if (best < 0) throw new Error("no filter chosen");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(out, { level: 9, memLevel: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The same image, losslessly smaller: opaque RGBA becomes RGB, then re-encoded. */
export function optimisePng(png: Buffer): Buffer {
  const pixels = decodePng(png);
  let opaque = pixels.channels === 4;
  for (let i = 3; opaque && i < pixels.data.length; i += 4) opaque = pixels.data[i] === 255;
  if (!opaque) return smaller(png, encodePng(pixels));
  const rgb = Buffer.alloc((pixels.data.length / 4) * 3);
  for (let i = 0, j = 0; i < pixels.data.length; i += 4, j += 3) {
    rgb[j] = pixels.data[i]!;
    rgb[j + 1] = pixels.data[i + 1]!;
    rgb[j + 2] = pixels.data[i + 2]!;
  }
  return smaller(png, encodePng({ ...pixels, channels: 3, data: rgb }));
}

function smaller(a: Buffer, b: Buffer): Buffer {
  return b.length < a.length ? b : a;
}
