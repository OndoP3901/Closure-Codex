param([long] $PetHandle)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ClosureFullscreen {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MonitorInfo {
        public int Size;
        public Rect Monitor;
        public Rect Work;
        public uint Flags;
    }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    public static string ClassOf(IntPtr hwnd) {
        var name = new StringBuilder(64);
        GetClassName(hwnd, name, name.Capacity);
        return name.ToString();
    }

    public static bool IsShell(IntPtr hwnd) {
        string kind = ClassOf(hwnd);
        return kind == "Progman" || kind == "WorkerW" ||
               kind == "Shell_TrayWnd" || kind == "Shell_SecondaryTrayWnd";
    }

    public static bool IsMaximized(IntPtr hwnd) {
        return (GetWindowLong(hwnd, -16) & 0x01000000) != 0; // WS_MAXIMIZE
    }

    // Desktop organizers, wallpaper engines and input overlays usually use
    // WS_EX_TOOLWINDOW. They may cover the monitor but are not fullscreen apps.
    public static bool IsToolWindow(IntPtr hwnd) {
        return (GetWindowLong(hwnd, -20) & 0x00000080) != 0;
    }

    public static bool IsInputHost(IntPtr hwnd) {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        try { return System.Diagnostics.Process.GetProcessById((int)processId).ProcessName == "TextInputHost"; }
        catch { return false; }
    }

    public static bool CoversMonitor(IntPtr hwnd) {
        Rect window;
        if (!GetWindowRect(hwnd, out window)) return false;
        IntPtr monitor = MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
        var info = new MonitorInfo();
        info.Size = Marshal.SizeOf(typeof(MonitorInfo));
        if (!GetMonitorInfo(monitor, ref info)) return false;
        return window.Left <= info.Monitor.Left + 2 && window.Top <= info.Monitor.Top + 2 &&
               window.Right >= info.Monitor.Right - 2 && window.Bottom >= info.Monitor.Bottom - 2;
    }
}
'@

[void][ClosureFullscreen]::SetThreadDpiAwarenessContext([IntPtr](-4))
$pet = [IntPtr]$PetHandle
$last = ''

do {
    $active = [ClosureFullscreen]::GetForegroundWindow()
    $fullscreen = $active -ne [IntPtr]::Zero -and $active -ne $pet -and
        [ClosureFullscreen]::IsWindowVisible($active) -and
        ![ClosureFullscreen]::IsIconic($active) -and
        ![ClosureFullscreen]::IsShell($active) -and
        ![ClosureFullscreen]::IsToolWindow($active) -and
        ![ClosureFullscreen]::IsInputHost($active) -and
        ![ClosureFullscreen]::IsMaximized($active) -and
        [ClosureFullscreen]::CoversMonitor($active)
    $line = if ($fullscreen) { '{"fullscreen":true}' } else { '{"fullscreen":false}' }
    if ($line -ne $last) {
        [Console]::WriteLine($line)
        $last = $line
    }
    Start-Sleep -Milliseconds 250
} while ($true)
