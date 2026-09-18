// N-API bridge from Node to IShellItemImageFactory::GetImage.
//
// Unlike the koffi candidate, this compiles against the real Windows SDK
// headers, so the compiler enforces the vtable layout, struct sizes and
// calling convention that had to be hand-verified byte-by-byte for koffi.
// Exposes extractIconBgra(path: string, size: number) -> Buffer of raw
// top-down BGRA pixels (size*size*4 bytes); PNG encoding happens in JS via
// lib/png.mjs, same as the koffi path, so both bridges are compared on
// identical downstream work.
#include <napi.h>
#include <windows.h>
#include <shobjidl.h>
#include <string>
#include <vector>
#include <stdexcept>

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Gdi32.lib")
#pragma comment(lib, "User32.lib")

namespace {

bool g_comInitialized = false;

std::string HrHex(HRESULT hr) {
  char buf[16];
  snprintf(buf, sizeof(buf), "0x%08lX", static_cast<unsigned long>(hr));
  return std::string(buf);
}

// Round-2 review finding 5: the previous version threw the bare string
// "CoInitializeEx failed" with no HRESULT, discarding `hr` before the throw
// site — the one failure mode most likely to occur once PLAT-03 calls this
// from Electron's main process is RPC_E_CHANGED_MODE (host already
// initialized COM in a different apartment), which would have been reported
// identically to every other failure. Fixed: EnsureCom returns the HRESULT
// so the caller can include HrHex(hr) in the thrown message, matching every
// other error path in this file (SHCreateItemFromParsingName / GetImage
// already did this).
HRESULT EnsureCom() {
  if (g_comInitialized) return S_OK;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (SUCCEEDED(hr) || hr == S_FALSE) {
    g_comInitialized = true;
  }
  return hr;
}

// Round-2 review finding 3: koffi's candidate silently normalized paths via
// Node's path.resolve() before calling SHCreateItemFromParsingName; this
// addon passed the raw UTF-16 string straight through. A forward-slash path
// ("C:/Windows/System32/notepad.exe") therefore returned E_INVALIDARG
// (hr=0x80070057) here while succeeding on koffi — the two "identical"
// bridges were doing unequal work. Fixed by normalizing through the same
// Win32 API the koffi bridge now also calls directly (see
// lib/win32-path.mjs on the JS side): GetFullPathNameW.
//
// Documented contract (see lib/win32-path.mjs for the full statement,
// verified empirically, not assumed): converts '/' to '\', resolves '.'/
// '..' and relative paths against the CWD, strips trailing dots/spaces from
// the final component. Does NOT expand %ENV% vars and does NOT strip
// surrounding quotes or a trailing ",<icon-index>" registry suffix — a
// caller feeding raw registry DisplayIcon values must handle those first.
std::u16string NormalizeWin32Path(const std::u16string& in) {
  LPCWSTR inPtr = reinterpret_cast<LPCWSTR>(in.c_str());
  DWORD needed = GetFullPathNameW(inPtr, 0, nullptr, nullptr);
  if (needed == 0) {
    throw std::runtime_error("GetFullPathNameW failed to size path (GetLastError=" +
                              std::to_string(GetLastError()) + ")");
  }
  std::vector<wchar_t> buf(needed);
  DWORD written = GetFullPathNameW(inPtr, needed, buf.data(), nullptr);
  if (written == 0 || written >= needed) {
    throw std::runtime_error("GetFullPathNameW failed to normalize path (GetLastError=" +
                              std::to_string(GetLastError()) + ")");
  }
  return std::u16string(reinterpret_cast<const char16_t*>(buf.data()), written);
}

}  // namespace

Napi::Value ExtractIconBgra(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
    Napi::TypeError::New(env, "extractIconBgra(path: string, size: number)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::u16string pathU16 = info[0].As<Napi::String>().Utf16Value();
  int size = info[1].As<Napi::Number>().Int32Value();
  if (size <= 0 || size > 2048) {
    Napi::RangeError::New(env, "size out of range").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::u16string normalizedPath;
  try {
    normalizedPath = NormalizeWin32Path(pathU16);
  } catch (const std::exception& e) {
    Napi::Error::New(env, std::string("path normalization failed: ") + e.what())
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  HRESULT comHr = EnsureCom();
  if (!g_comInitialized) {
    Napi::Error::New(env, "CoInitializeEx failed hr=" + HrHex(comHr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  IShellItemImageFactory* factory = nullptr;
  HRESULT hr = SHCreateItemFromParsingName(
      reinterpret_cast<LPCWSTR>(normalizedPath.c_str()), nullptr, IID_PPV_ARGS(&factory));
  if (FAILED(hr) || factory == nullptr) {
    Napi::Error::New(env, "SHCreateItemFromParsingName failed hr=" + HrHex(hr))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  HBITMAP hbm = nullptr;
  SIZE sz;
  sz.cx = size;
  sz.cy = size;
  hr = factory->GetImage(sz, SIIGBF_RESIZETOFIT, &hbm);
  factory->Release();

  if (FAILED(hr) || hbm == nullptr) {
    Napi::Error::New(env, "GetImage failed hr=" + HrHex(hr)).ThrowAsJavaScriptException();
    return env.Null();
  }

  HDC hdc = GetDC(nullptr);
  if (hdc == nullptr) {
    DeleteObject(hbm);
    Napi::Error::New(env, "GetDC failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  BITMAPINFO bmi;
  ZeroMemory(&bmi, sizeof(bmi));
  bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bmi.bmiHeader.biWidth = size;
  bmi.bmiHeader.biHeight = -size;  // negative = top-down DIB
  bmi.bmiHeader.biPlanes = 1;
  bmi.bmiHeader.biBitCount = 32;
  bmi.bmiHeader.biCompression = BI_RGB;

  Napi::Buffer<uint8_t> buffer =
      Napi::Buffer<uint8_t>::New(env, static_cast<size_t>(size) * size * 4);
  int lines = GetDIBits(hdc, hbm, 0, size, buffer.Data(), &bmi, DIB_RGB_COLORS);

  ReleaseDC(nullptr, hdc);
  DeleteObject(hbm);

  if (lines == 0) {
    Napi::Error::New(env, "GetDIBits failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  return buffer;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("extractIconBgra", Napi::Function::New(env, ExtractIconBgra));
  return exports;
}

NODE_API_MODULE(iconaddon, Init)
