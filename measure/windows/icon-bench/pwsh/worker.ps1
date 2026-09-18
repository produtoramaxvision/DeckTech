# Persistent PowerShell worker for the "pooled PowerShell" icon-extraction
# candidate. One process is spawned per pool slot and kept alive across many
# requests, so the (large, one-time) Add-Type C# compilation cost is paid
# once per worker, not once per icon — that is the whole point of pooling.
#
# Protocol: newline-delimited JSON on stdin/stdout.
#   -> {"id": 1, "path": "C:\\...\\app.exe", "out": "C:\\...\\out.png", "size": 256}
#   <- {"id": 1, "ok": true, "ms": 12.3}                     on success
#   <- {"id": 1, "ok": false, "error": "..."}                on failure
#   A line "READY" is printed once, after Add-Type compiles, so the caller
#   can separate one-time startup cost from steady-state per-icon cost.
#
# COM interop is done via .NET's built-in [ComImport] marshalling instead of
# manual vtable calls (that is precisely the ergonomic advantage this
# candidate is being benchmarked for) — the CLR generates the vtable dispatch
# from the [ComImport] interface declaration.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

[StructLayout(LayoutKind.Sequential)]
public struct SIZE { public int cx; public int cy; }

[StructLayout(LayoutKind.Sequential)]
public struct BITMAPINFOHEADER
{
    public uint biSize;
    public int biWidth;
    public int biHeight;
    public ushort biPlanes;
    public ushort biBitCount;
    public uint biCompression;
    public uint biSizeImage;
    public int biXPelsPerMeter;
    public int biYPelsPerMeter;
    public uint biClrUsed;
    public uint biClrImportant;
}

[ComImport]
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory
{
    [PreserveSig]
    int GetImage(SIZE size, int flags, out IntPtr phbm);
}

public static class IconNative
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    public static extern int SHCreateItemFromParsingName(
        string path, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    public static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines,
        [Out] byte[] pixels, ref BITMAPINFOHEADER bmi, uint usage);

    // NOTE: Image.FromHbitmap(hbm) was the first cut here and is a documented
    // .NET pitfall — it discards the alpha channel, so every icon's
    // transparent/rounded corners came back OPAQUE BLACK instead of
    // transparent (confirmed visually: compare .tmp/cache/pwsh/1.png before
    // this fix against .tmp/cache/addon/1.png, same app, same GetImage call).
    // Fixed the same way the addon/koffi candidates already do it: pull raw
    // BGRA pixels via GetDIBits and build the Bitmap from that buffer with
    // PixelFormat.Format32bppArgb, so all three candidates preserve alpha
    // identically and the timing comparison is apples-to-apples on OUTPUT
    // CORRECTNESS, not just wall-clock.
    public static void ExtractToPng(string path, string outFile, int size)
    {
        Guid iid = typeof(IShellItemImageFactory).GUID;
        IShellItemImageFactory factory = null;
        int hr = SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out factory);
        if (hr != 0 || factory == null)
            throw new Exception("SHCreateItemFromParsingName hr=0x" + hr.ToString("X8"));

        IntPtr hbm = IntPtr.Zero;
        try
        {
            SIZE sz = new SIZE { cx = size, cy = size };
            const int SIIGBF_RESIZETOFIT = 0x0;
            int hr2 = factory.GetImage(sz, SIIGBF_RESIZETOFIT, out hbm);
            if (hr2 != 0 || hbm == IntPtr.Zero)
                throw new Exception("GetImage hr=0x" + hr2.ToString("X8"));

            IntPtr hdc = GetDC(IntPtr.Zero);
            if (hdc == IntPtr.Zero) throw new Exception("GetDC failed");
            try
            {
                var bmi = new BITMAPINFOHEADER
                {
                    biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER)),
                    biWidth = size,
                    biHeight = -size, // top-down DIB
                    biPlanes = 1,
                    biBitCount = 32,
                    biCompression = 0, // BI_RGB
                };
                byte[] pixels = new byte[size * size * 4];
                int lines = GetDIBits(hdc, hbm, 0, (uint)size, pixels, ref bmi, 0 /* DIB_RGB_COLORS */);
                if (lines == 0) throw new Exception("GetDIBits failed");

                using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                {
                    BitmapData data = bmp.LockBits(new Rectangle(0, 0, size, size),
                        ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
                    }
                    finally
                    {
                        bmp.UnlockBits(data);
                    }
                    bmp.Save(outFile, ImageFormat.Png);
                }
            }
            finally
            {
                ReleaseDC(IntPtr.Zero, hdc);
            }
        }
        finally
        {
            if (hbm != IntPtr.Zero) DeleteObject(hbm);
            if (factory != null) Marshal.ReleaseComObject(factory);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq '') { continue }

    try {
        $req = $line | ConvertFrom-Json
    } catch {
        continue
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        [IconNative]::ExtractToPng($req.path, $req.out, [int]$req.size)
        $sw.Stop()
        $resp = @{ id = $req.id; ok = $true; ms = $sw.Elapsed.TotalMilliseconds } | ConvertTo-Json -Compress
    } catch {
        $sw.Stop()
        $resp = @{ id = $req.id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
    [Console]::Out.WriteLine($resp)
    [Console]::Out.Flush()
}
