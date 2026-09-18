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

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Gdi32.lib")
#pragma comment(lib, "User32.lib")

namespace {

bool g_comInitialized = false;

void EnsureCom() {
  if (g_comInitialized) return;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (SUCCEEDED(hr) || hr == S_FALSE) {
    g_comInitialized = true;
  }
}

std::string HrHex(HRESULT hr) {
  char buf[16];
  snprintf(buf, sizeof(buf), "0x%08lX", static_cast<unsigned long>(hr));
  return std::string(buf);
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

  EnsureCom();
  if (!g_comInitialized) {
    Napi::Error::New(env, "CoInitializeEx failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  IShellItemImageFactory* factory = nullptr;
  HRESULT hr = SHCreateItemFromParsingName(
      reinterpret_cast<LPCWSTR>(pathU16.c_str()), nullptr, IID_PPV_ARGS(&factory));
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
