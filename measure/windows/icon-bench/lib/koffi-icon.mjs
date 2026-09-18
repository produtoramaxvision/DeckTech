// koffi (pure-JS FFI) bridge from Node to IShellItemImageFactory::GetImage.
//
// COM has no C ABI entry points for interface methods — a COM object is a
// pointer to a vtable (an array of function pointers), and the interface's
// methods sit at fixed slot indices after IUnknown's three. koffi has no
// native COM support, so this module reads the vtable by hand with
// koffi.decode(ptr, type, offset) and calls each slot as a __stdcall function
// pointer via koffi.decode(slotPtr, protoType).
//
// Slot layout verified against the ACTUAL Windows SDK header installed on
// this machine (not memory, not a guess):
//   C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um\ShObjIdl_core.h
//   IShellItemImageFactoryVtbl: 0=QueryInterface 1=AddRef 2=Release 3=GetImage
//   IID_IShellItemImageFactory = bcc18b79-ba16-442f-80c4-8a59c30c463b (same header)
//
// IUnknown's own three slots come from the same header (unnamed.h / objidl —
// every COM interface has this layout by the COM ABI spec: it is not
// interface-specific and does not vary).

import koffi from "koffi";
import { normalizeWin32Path } from "./win32-path.mjs";

const ole32 = koffi.load("ole32.dll");
const shell32 = koffi.load("shell32.dll");
const gdi32 = koffi.load("gdi32.dll");
const user32 = koffi.load("user32.dll");

const COINIT_APARTMENTTHREADED = 0x2;

const CoInitializeEx = ole32.func("__stdcall", "CoInitializeEx", "long", ["void *", "uint32"]);
const CoUninitialize = ole32.func("__stdcall", "CoUninitialize", "void", []);

// SHCreateItemFromParsingName(PCWSTR pszPath, IBindCtx *pbc, REFIID riid, void **ppv)
// REFIID is a pointer to a 16-byte GUID struct; we pass it as a raw buffer.
const SHCreateItemFromParsingName = shell32.func(
  "__stdcall",
  "SHCreateItemFromParsingName",
  "long",
  ["str16", "void *", "void *", koffi.out(koffi.pointer("void *"))]
);

// BITMAPINFOHEADER + GetDIBits, used to pull raw pixels out of the HBITMAP
// GetImage hands back (same approach the N-API addon uses, so both bridges
// go through the identical GDI extraction path and differ only in how they
// reach GetImage itself).
const BITMAPINFOHEADER = koffi.struct("BITMAPINFOHEADER", {
  biSize: "uint32",
  biWidth: "int32",
  biHeight: "int32",
  biPlanes: "uint16",
  biBitCount: "uint16",
  biCompression: "uint32",
  biSizeImage: "uint32",
  biXPelsPerMeter: "int32",
  biYPelsPerMeter: "int32",
  biClrUsed: "uint32",
  biClrImportant: "uint32",
});
const RGBQUAD = koffi.struct("RGBQUAD", { b: "uint8", g: "uint8", r: "uint8", a: "uint8" });
const BITMAPINFO = koffi.struct("BITMAPINFO", {
  bmiHeader: BITMAPINFOHEADER,
  bmiColors: koffi.array(RGBQUAD, 1),
});

const GetDIBits = gdi32.func("__stdcall", "GetDIBits", "int", [
  "void *", // HDC
  "void *", // HBITMAP
  "uint32", // start scan
  "uint32", // scan lines
  "void *", // out bits buffer (or null on first call)
  koffi.inout(koffi.pointer(BITMAPINFO)),
  "uint32", // usage
]);
const GetDC = user32.func("__stdcall", "GetDC", "void *", ["void *"]);
const ReleaseDC = user32.func("__stdcall", "ReleaseDC", "int", ["void *", "void *"]);
const DeleteObject = gdi32.func("__stdcall", "DeleteObject", "int", ["void *"]);

// -- Manual COM vtable plumbing -----------------------------------------

const PTR_SIZE = koffi.sizeof("void *");

// SIZE must travel as an 8-byte struct passed BY VALUE (Win64 calling
// convention packs it into a single register slot); splitting it into two
// separate int32 args — which looks equivalent in C — shifts every argument
// after it by one slot and segfaults on the real call. Verified empirically:
// the two-int32 version crashed the process (SIGSEGV) on GetImage.
const SIZE = koffi.struct("SIZE", { cx: "int32", cy: "int32" });

// this, SIZE (by value), flags (int32), out HBITMAP*
const GetImageProto = koffi.proto(
  "__stdcall",
  "GetImageFn",
  "long",
  ["void *", SIZE, "int32", koffi.out(koffi.pointer("void *"))]
);
const ReleaseProto = koffi.proto("__stdcall", "ReleaseFn", "uint32", ["void *"]);

// Decoded-function cache, keyed by the raw vtable-slot pointer value. Every
// IShellItemImageFactory instance SHCreateItemFromParsingName hands back
// shares the same underlying COM class implementation (the shell's item
// factory), so its vtable pointer is stable across calls in practice; only
// the object (`this`) pointer differs per file. Re-running koffi.decode() on
// the same slot on every single call was measured to cost real time (a
// first cut of this module did that and came out ~2.5x slower than the
// addon on a warm shell cache — see docs/adr for the number); caching the
// decoded function object once per distinct vtable slot is the fix a real
// implementation would make, so it is applied here rather than benchmarking
// an avoidably naive version.
const decodedFnCache = new Map();

function vtableSlot(objPtr, index, proto) {
  const vtablePtr = koffi.decode(objPtr, "void *"); // dereference obj -> vtable
  // koffi.decode(ptr, offset, type) — offset precedes type in this overload;
  // decode(ptr, type, N) instead decodes an N-element ARRAY of `type`, which
  // is a different, easy-to-hit call shape (verified empirically: putting
  // the offset where `type` expects a length silently returned a 24-element
  // BigInt array instead of throwing).
  const slotPtr = koffi.decode(vtablePtr, index * PTR_SIZE, "void *"); // vtable[index]
  const cacheKey = String(slotPtr);
  let fn = decodedFnCache.get(cacheKey);
  if (!fn) {
    fn = koffi.decode(slotPtr, proto);
    decodedFnCache.set(cacheKey, fn);
  }
  return fn;
}

let comInitialized = false;
function ensureCom() {
  if (comInitialized) return;
  const hr = CoInitializeEx(null, COINIT_APARTMENTTHREADED);
  // S_OK=0, S_FALSE=1 (already initialized) are both fine.
  if (hr !== 0 && hr !== 1) throw new Error(`CoInitializeEx failed hr=0x${(hr >>> 0).toString(16)}`);
  comInitialized = true;
}

const IID_IShellItemImageFactory = Buffer.from([
  // bcc18b79-ba16-442f-80c4-8a59c30c463b, little-endian per GUID wire format
  0x79, 0x8b, 0xc1, 0xbc, 0x16, 0xba, 0x2f, 0x44, 0x80, 0xc4, 0x8a, 0x59, 0xc3, 0x0c, 0x46, 0x3b,
]);

/**
 * Extracts a `size`x`size` icon/thumbnail for `targetPath` via
 * IShellItemImageFactory::GetImage, returning raw top-down BGRA pixels.
 * @returns {{width:number, height:number, bgra:Buffer}}
 */
export function extractIconBgra(targetPath, size = 256) {
  ensureCom();
  // Round-2 review finding 3: normalize via the REAL Win32 GetFullPathNameW
  // API (lib/win32-path.mjs), not Node's path.resolve — the addon now does
  // the identical OS-level call internally, so both bridges accept/reject
  // the identical set of inputs. See win32-path.mjs for the documented,
  // verified path contract (what this DOES and does NOT normalize).
  const absPath = normalizeWin32Path(targetPath);

  const itemOut = [null];
  const hrCreate = SHCreateItemFromParsingName(absPath, null, IID_IShellItemImageFactory, itemOut);
  if (hrCreate !== 0 || !itemOut[0]) {
    throw new Error(`SHCreateItemFromParsingName failed hr=0x${(hrCreate >>> 0).toString(16)} for ${absPath}`);
  }
  const item = itemOut[0];

  try {
    const GetImage = vtableSlot(item, 3, GetImageProto);

    const SIIGBF_RESIZETOFIT = 0x0;
    const hbmOut = [null];
    const hrImg = GetImage(item, { cx: size, cy: size }, SIIGBF_RESIZETOFIT, hbmOut);
    if (hrImg !== 0 || !hbmOut[0]) {
      throw new Error(`GetImage failed hr=0x${(hrImg >>> 0).toString(16)} for ${absPath}`);
    }
    const hbm = hbmOut[0];

    try {
      const hdc = GetDC(null);
      try {
        const bmi = {
          bmiHeader: {
            biSize: 40,
            biWidth: size,
            biHeight: -size, // negative = top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
          },
          bmiColors: [{ b: 0, g: 0, r: 0, a: 0 }],
        };
        const bufSize = size * size * 4;
        const pixels = Buffer.alloc(bufSize);
        const DIB_RGB_COLORS = 0;
        const lines = GetDIBits(hdc, hbm, 0, size, pixels, bmi, DIB_RGB_COLORS);
        if (lines === 0) throw new Error(`GetDIBits failed for ${absPath}`);
        return { width: size, height: size, bgra: pixels };
      } finally {
        ReleaseDC(null, hdc);
      }
    } finally {
      DeleteObject(hbm);
    }
  } finally {
    const Release = vtableSlot(item, 2, ReleaseProto);
    Release(item);
  }
}

export function comUninitialize() {
  if (comInitialized) {
    CoUninitialize();
    comInitialized = false;
  }
}
