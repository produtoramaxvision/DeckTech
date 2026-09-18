// Minimal, dependency-free RGBA -> PNG encoder used by the koffi and N-API
// candidates (both hand back raw top-down BGRA/RGBA pixel bytes from GDI and
// need to produce the same PNG artifact PLAT-03 requires). Uses Node's
// built-in zlib for the DEFLATE stream — no external PNG library, so encode
// cost is attributable and comparable across candidates.
import { deflateSync } from "node:zlib";
import { crc32 } from "node:zlib";

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeData) >>> 0, 0);
  return Buffer.concat([len, typeData, crcBuf]);
}

/**
 * @param {Buffer} rgba - width*height*4 bytes, row-major, top-down, RGBA order
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} PNG file bytes
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: buffer length ${rgba.length} != ${width}x${height}x4`);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines with a leading filter-type byte (0 = none) per row.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw, { level: 6 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Converts a Windows top-down 32bpp BGRA DIB buffer to RGBA in place order (new buffer). */
export function bgraToRgba(bgra) {
  const out = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    out[i] = bgra[i + 2]; // R
    out[i + 1] = bgra[i + 1]; // G
    out[i + 2] = bgra[i]; // B
    out[i + 3] = bgra[i + 3]; // A
  }
  return out;
}
