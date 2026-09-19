import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

/**
 * Minimal valid PNG of the given dimensions, written without an image library.
 * The header is what image-size reads; `tint` adds a text chunk so two
 * files of the same size hash differently.
 */
export function writePng(path: string, width: number, height: number, pad = 0, tint = 0): void {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
  ];
  if (tint > 0) parts.push(chunk("tEXt", Buffer.from(`tint\0${tint}`, "latin1")));
  if (pad > 0) parts.push(chunk("teXt", Buffer.alloc(pad)));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  writeFileSync(path, Buffer.concat(parts));
}
