param([switch] $Stop, [switch] $Probe, [switch] $NoActivity)

$ErrorActionPreference = 'Stop'
$mutexName = 'Local\ClosureCodexLifecycle.v1'
$stopName = 'Local\ClosureCodexLifecycle.Stop.v1'
if ($Stop) {
    try { $signal = [Threading.EventWaitHandle]::OpenExisting($stopName) }
    catch [Threading.WaitHandleCannotBeOpenedException] { return }
    try { [void]$signal.Set() } finally { $signal.Dispose() }
    return
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClosureLifecycleWindows {
    private delegate bool VisitWindow(IntPtr window, IntPtr ignored);
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] private static extern bool EnumWindows(VisitWindow visit, IntPtr ignored);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relation);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder result, int count);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr first, IntPtr second);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CommandLineToArgvW(string line, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    public static int[] OpenWindowProcesses() {
        var processes = new HashSet<int>();
        EnumWindows((window, unused) => {
            if (!IsWindowVisible(window) || GetWindow(window, 4) != IntPtr.Zero || (GetWindowLong(window, -20) & 0x80) != 0) return true;
            var kind = new StringBuilder(48);
            GetClassName(window, kind, kind.Capacity);
            if (kind.ToString() != "Chrome_WidgetWin_1") return true;
            Rect bounds;
            if (!IsIconic(window) && (!GetWindowRect(window, out bounds) || bounds.Right == bounds.Left || bounds.Bottom == bounds.Top)) return true;
            int pid;
            GetWindowThreadProcessId(window, out pid);
            if (pid != 0) processes.Add(pid);
            return true;
        }, IntPtr.Zero);
        var ids = new int[processes.Count];
        processes.CopyTo(ids);
        return ids;
    }

    public static bool CloseHelper(int processId) {
        bool sent = false;
        string expected = "\u53ef\u9732\u5e0c\u5c14 \u00b7 Codex \u684c\u5ba0";
        EnumWindows((window, unused) => {
            int owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId) return true;
            var title = new StringBuilder(64);
            GetWindowText(window, title, title.Capacity);
            if (title.ToString() != expected) return true;
            sent = PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            return false;
        }, IntPtr.Zero);
        return sent;
    }

    public static string[] SplitCommandLine(string command) {
        int count;
        IntPtr memory = CommandLineToArgvW(command, out count);
        if (memory == IntPtr.Zero) return new string[0];
        try {
            var args = new string[count];
            for (int i = 0; i < count; i++) args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            return args;
        } finally { LocalFree(memory); }
    }
}
'@

$sessionId = (Get-Process -Id $PID).SessionId
$outputRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = [IO.Path]::GetFullPath((Join-Path $outputRoot '../work'))
$petApp = Join-Path $outputRoot 'closure-companion'
$electronExe = Join-Path $workRoot 'companion-runtime/electron/electron.exe'
$launchModePath = Join-Path $workRoot 'companion-profile/launch-mode.txt'
$knownProcesses = @{}

function Test-CodexOpen {
    $windowProcesses = [ClosureLifecycleWindows]::OpenWindowProcesses()
    foreach ($id in @($knownProcesses.Keys)) {
        if ($id -notin $windowProcesses) { $knownProcesses.Remove($id) }
    }
    foreach ($id in $windowProcesses) {
        if (!$knownProcesses.ContainsKey($id)) {
            $process = Get-Process -Id $id -ErrorAction SilentlyContinue
            $knownProcesses[$id] = $process -and $process.SessionId -eq $sessionId -and
                $process.Path -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+__2p2nqsd0c76g0\\app\\(?:ChatGPT|Codex)\.exe$'
        }
        if ($knownProcesses[$id]) { return $true }
    }
    return $false
}

function Find-OpenHelpers {
    $pet = $null
    foreach ($process in (Get-CimInstance Win32_Process -Filter "Name='electron.exe' AND SessionId=$sessionId" -ErrorAction SilentlyContinue)) {
        if ($process.ExecutablePath -ne $electronExe -or !$process.CommandLine) { continue }
        $arguments = [ClosureLifecycleWindows]::SplitCommandLine($process.CommandLine)
        if ($arguments.Length -lt 2 -or $arguments -contains '--demo' -or $arguments -contains '--smoke') { continue }
        if (![IO.Path]::IsPathRooted($arguments[1])) { continue }
        if ([IO.Path]::GetFullPath($arguments[1]).TrimEnd('\') -ne $petApp) { continue }
        $pet = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
        if ($pet) { break }
    }
    return @{ Pet = $pet }
}

function Start-Helper($key) {
    $env:CLOSURE_STATE_DIR = Join-Path $workRoot 'companion-profile'
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $arguments = '"' + $petApp + '" --no-tray'
    if (!$NoActivity) { $arguments += ' --follow-activity' }
    return Start-Process -FilePath $electronExe -ArgumentList $arguments -WindowStyle Hidden -PassThru
}

function Write-LifecycleLog($message) {
    try {
        $log = Join-Path $workRoot 'lifecycle.log'
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -ge 65536) {
            Move-Item -LiteralPath $log -Destination "$log.old" -Force
        }
        Add-Content -LiteralPath $log -Encoding UTF8 -Value "$(Get-Date -Format o) $message"
    } catch { Write-Verbose 'Could not write the lifecycle log.' }
}

function Update-Helpers($children, $recovery, [long] $now, $keys = @('Pet'), [bool] $standalone = $false) {
    foreach ($key in $keys) {
        $state = $recovery[$key]
        $process = $children[$key]
        if ($process) {
            if (!$process.HasExited) {
                if ($now - $state.Started -ge 60000) { $state.Attempts = 0; $state.Due = $now }
                continue
            }
            $code = try { $process.ExitCode } catch [InvalidOperationException] { 'unknown' }
            if ($key -eq 'Pet' -and $standalone) {
                Write-LifecycleLog "$key exited with code $code in standalone mode."
            } else {
                Write-LifecycleLog "$key exited with code $code while Codex was open."
            }
            $process.Dispose()
            $children[$key] = $null
            if ($key -eq 'Pet' -and $standalone -and $code -eq 0) { $state.Due = [long]::MaxValue }
            else { $state.Due = $now + 1000 }
        }
        if ($state.Attempts -ge 4 -or $now -lt $state.Due) { continue }

        $state.Attempts++
        $state.Started = $now
        try {
            $children[$key] = Start-Helper $key
            Write-LifecycleLog "$key started (attempt $($state.Attempts))."
        } catch {
            Write-LifecycleLog "$key launch failed ($($_.Exception.GetType().Name))."
            $state.Due = $now + 1000
        }
        if ($state.Attempts -eq 4) {
            Write-LifecycleLog "$key reached its launch limit. It resets after a stable run or after closing and reopening Codex."
        }
    }
}

function Stop-Helpers($children, $keys = @('Pet')) {
    foreach ($key in $keys) {
        $process = $children[$key]
        if (!$process) { continue }
        try {
            if (!$process.HasExited) {
                [void][ClosureLifecycleWindows]::CloseHelper($process.Id)
                if (!$process.WaitForExit(1600)) { $process.Kill() }
            }
        } catch [InvalidOperationException] { }
        finally { $process.Dispose(); $children[$key] = $null }
    }
}

if ($Probe) {
    $helpers = Find-OpenHelpers
    [pscustomobject]@{ CodexOpen = (Test-CodexOpen); Pet = $helpers.Pet.Id }
    return
}

$mutex = [Threading.Mutex]::new($false, $mutexName)
$ownsMutex = $false
$signal = $null
$children = @{ Pet = $null }
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (!$ownsMutex) { return }
    $signal = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $stopName)
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $lastOpen = $null
    $required = @{ Pet = $false }
    $recovery = @{}
    $previousStandalone = $true
    do {
        $now = $clock.ElapsedMilliseconds
        if (Test-CodexOpen) { $lastOpen = $now }
        $codexOpen = $null -ne $lastOpen -and $now - $lastOpen -lt 1500
        $standalone = $previousStandalone
        try {
            $standalone = [IO.File]::ReadAllText($launchModePath).Trim() -ne 'codex'
        } catch [IO.FileNotFoundException], [IO.DirectoryNotFoundException] {
            $standalone = $true
        } catch [IO.IOException] {
            # Use the last mode if the settings file is temporarily unavailable.
        }
        $needed = @{ Pet = $codexOpen -or $standalone }
        foreach ($key in 'Pet') {
            if (!$needed[$key]) {
                if ($children[$key]) { Stop-Helpers $children @($key) }
            } else {
                if (!$required[$key] -or ($key -eq 'Pet' -and $standalone -ne $previousStandalone)) {
                    if (!$children[$key]) { $children[$key] = (Find-OpenHelpers)[$key] }
                    $recovery[$key] = @{ Attempts = [int][bool]$children[$key]; Started = $now; Due = 0 }
                }
                Update-Helpers $children $recovery $now @($key) $standalone
            }
            $required[$key] = $needed[$key]
        }
        $previousStandalone = $standalone
    } until ($signal.WaitOne(350))
} finally {
    if ($ownsMutex) {
        if (!$children.Pet) {
            $running = Find-OpenHelpers
            foreach ($key in 'Pet') {
                if (!$children[$key]) { $children[$key] = $running[$key] }
            }
        }
        Stop-Helpers $children
        if ($signal) { $signal.Dispose() }
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
