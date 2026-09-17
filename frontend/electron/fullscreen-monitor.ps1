param([int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AnimeFullscreen {
  public delegate bool Callback(IntPtr hwnd, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback cb, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out Rect value, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int GetCloaked(IntPtr hwnd, int attr, out int value, int size);
  public static string Scan(int owner) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var found = new List<string>();
    // Wallpaper and desktop utilities can fill a monitor without being an
    // active fullscreen app. Only the foreground window may hide the widget.
    var foreground = GetForegroundWindow();
    EnumWindows(delegate(IntPtr hwnd, IntPtr data) {
      if (hwnd != foreground) return true;
      uint process; GetWindowThreadProcessId(hwnd, out process);
      if (process == owner || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return true;
      var name = new StringBuilder(256); GetClassName(hwnd, name, 256);
      if (name.ToString() == "Progman" || name.ToString() == "WorkerW" || name.ToString().Contains("TrayWnd")) return true;
      int cloaked; if (GetCloaked(hwnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      Rect r; if (DwmGetWindowAttribute(hwnd, 9, out r, 16) != 0) return true;
      var info = new MonitorInfo(); info.Size = Marshal.SizeOf(info);
      if (!GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info)) return true;
      var m = info.Monitor;
      if (Math.Abs(r.Left-m.Left) <= 2 && Math.Abs(r.Top-m.Top) <= 2 && Math.Abs(r.Right-m.Right) <= 2 && Math.Abs(r.Bottom-m.Bottom) <= 2)
        found.Add("{\"x\":"+m.Left+",\"y\":"+m.Top+",\"width\":"+(m.Right-m.Left)+",\"height\":"+(m.Bottom-m.Top)+"}");
      return true;
    }, IntPtr.Zero);
    return "[" + String.Join(",", found) + "]";
  }
}
'@
while (Get-Process -Id $OwnerProcessId -ErrorAction SilentlyContinue) {
  $windows = [AnimeFullscreen]::Scan($OwnerProcessId)
  $self = [System.Diagnostics.Process]::GetCurrentProcess()
  $cpuSeconds = $self.TotalProcessorTime.TotalSeconds.ToString([Globalization.CultureInfo]::InvariantCulture)
  [Console]::WriteLine('{"windows":' + $windows + ',"memoryKB":' + [Math]::Round($self.WorkingSet64 / 1024) + ',"cpuSeconds":' + $cpuSeconds + '}')
  Start-Sleep -Milliseconds 1000
}
