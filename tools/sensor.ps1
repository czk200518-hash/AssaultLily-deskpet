# ============================================================================
# Lily Pet - Scene Sensor (sensor.ps1)
#
# Started by the Electron main process (main.js). Emits one JSON line per event:
#   {"t":"hello","pid":1234}                   ready
#   {"t":"key","k":"A"}                        typing key pressed (letters/digits/space/enter/backspace/tab/punct)
#   {"t":"keystroke","vk":65}                  any key pressed (VK 8..254; for keystroke counting)
#   {"t":"btn","k":"left"}                     mouse button pressed (left/right/middle/x1/x2)
#   {"t":"pos","x":123,"y":456}                cursor position (screen physical pixels)
#   {"t":"cpu","p":23}                         total CPU load percent (every 3 s)
#   {"t":"media","s":true,"app":"Spotify.exe","music":true}
#                                              system media session playing state (every 3 s)
#
# Requires only the built-in Windows PowerShell 5.1.
#   - Keyboard/mouse: user32 GetAsyncKeyState / GetCursorPos polling (no global hooks)
#   - CPU:            ntdll NtQuerySystemInformation kernel perf info (millisecond-level,
#                     never blocks the poll loop; falls back to WMI Win32_Processor)
#   - Media:          WinRT SMTC (GlobalSystemMediaTransportControlsSessionManager,
#                     Windows 10 1803+; browsers/media apps register a session while playing,
#                     Artist non-empty means music, otherwise video)
#
# ENCODING WARNING: keep this file pure ASCII (or UTF-8 with BOM). Windows
# PowerShell 5.1 reads BOM-less files as ANSI/GBK; the byte sequences of CJK
# comments can swallow the following newline and merge the next code line into
# a comment, silently breaking compilation/parsing. ASCII comments are immune.
# ============================================================================
$ErrorActionPreference = 'SilentlyContinue'

# ---- user32 P/Invoke ----
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SensorNative {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT p);
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
}
// CPU load via ntdll NtQuerySystemInformation (fast, non-blocking).
// Avoid WMI/PDH: on some machines Win32_Processor / Get-Counter take >1 s per
// query, which would stall the 30 ms poll loop and drop keystroke/click counts.
public static class CpuNative {
    [DllImport("ntdll.dll")]
    public static extern int NtQuerySystemInformation(int SystemInformationClass, IntPtr SystemInformation, int SystemInformationLength, out int ReturnLength);
    [StructLayout(LayoutKind.Sequential)]
    public struct SPPI {
        public long IdleTime;
        public long KernelTime;
        public long UserTime;
        public long DpcTime;
        public long InterruptTime;
        public int InterruptCount;
    }
    // Returns { IdleTime, KernelTime, UserTime } totals across all cores; null on failure.
    public static long[] Sample() {
        try {
            int n = Environment.ProcessorCount;
            int size = Marshal.SizeOf(typeof(SPPI));
            IntPtr buf = Marshal.AllocHGlobal(size * n);
            try {
                int retLen;
                int ret = NtQuerySystemInformation(2, buf, size * n, out retLen);
                if (ret != 0) return null;
                long idle = 0, kernel = 0, user = 0;
                for (int i = 0; i < n; i++) {
                    SPPI info = (SPPI)Marshal.PtrToStructure(IntPtr.Add(buf, i * size), typeof(SPPI));
                    idle += info.IdleTime; kernel += info.KernelTime; user += info.UserTime;
                }
                return new long[] { idle, kernel, user };
            } finally {
                Marshal.FreeHGlobal(buf);
            }
        } catch {
            return null;
        }
    }
}
'@

function EmitJson($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)) }

# ---- Typing keys table (VK code -> display name) ----
$KEYS = @{}
65..90 | ForEach-Object { $KEYS[$_] = [char]$_ }          # A-Z
48..57 | ForEach-Object { $KEYS[$_] = [char]$_ }          # 0-9
$KEYS[0x20] = 'Space'; $KEYS[0x0D] = 'Enter'; $KEYS[0x08] = 'Backspace'; $KEYS[0x09] = 'Tab'
# Common punctuation (US layout; other layouts may miss a few keys, harmless for typing detection)
$KEYS[0xBA] = ';'; $KEYS[0xBB] = '='; $KEYS[0xBC] = ','; $KEYS[0xBD] = '-'
$KEYS[0xBE] = '.'; $KEYS[0xBF] = '/'; $KEYS[0xC0] = '`'
$KEYS[0xDB] = '['; $KEYS[0xDC] = '\'; $KEYS[0xDD] = ']'; $KEYS[0xDE] = "'"
$MOUSE = @{ 0x01 = 'left'; 0x02 = 'right'; 0x04 = 'middle'; 0x05 = 'x1'; 0x06 = 'x2' }
$prevKey = @{}
$prevBtn = @{}
$prevAll = @{}   # edge detection for the full VK scan (keystroke counting, VK 8..254)

# ---- WinRT SMTC (media playback detection; disabled when unsupported) ----
$smMgr = $null
$smOk = $false
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $smMgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $smOk = $true
} catch {
    $smMgr = $null
    $smOk = $false
}

function Get-MediaState {
    if (-not $smOk -or $null -eq $smMgr) { return @{ s = $false; app = ''; music = $false } }
    try {
        $sess = $smMgr.GetCurrentSession()
        if ($null -eq $sess) { return @{ s = $false; app = ''; music = $false } }
        $pi = $sess.GetPlaybackInfo()
        if ([int]$pi.PlaybackStatus -ne 4) { return @{ s = $false; app = ''; music = $false } }  # 4 = Playing
        $music = $false
        try {
            $props = Await ($sess.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            if ($props.Artist) { $music = $true }
        } catch { }
        $app = '' + $sess.SourceAppUserModelId
        $app = $app -replace '[^\x20-\x7E]', '?'
        return @{ s = $true; app = $app; music = $music }
    } catch {
        return @{ s = $false; app = ''; music = $false }
    }
}

# ---- CPU load (delta of two samples; first sample is baseline and returns -1) ----
$prevCpuSample = $null
function Get-CpuLoad {
    $sample = [CpuNative]::Sample()
    if ($null -eq $sample) {
        # Kernel API unavailable -> fall back to WMI (slow, only on broken systems)
        try { return [int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Maximum).Maximum }
        catch { return -1 }
    }
    if ($null -eq $script:prevCpuSample) { $script:prevCpuSample = $sample; return -1 }
    $idleDelta = $sample[0] - $script:prevCpuSample[0]
    $kernelDelta = $sample[1] - $script:prevCpuSample[1]
    $userDelta = $sample[2] - $script:prevCpuSample[2]
    $script:prevCpuSample = $sample
    $total = $kernelDelta + $userDelta   # KernelTime includes IdleTime
    if ($total -le 0) { return -1 }
    $busy = $total - $idleDelta
    return [int][Math]::Round(100.0 * $busy / $total)
}

EmitJson @{ t = 'hello'; pid = $PID }

$lastCpuAt = 0
$lastMediaAt = 0
$pollMs = 30
$tick = 0

while ($true) {
    # ---- Keyboard: edge detection, emit on press ----
    foreach ($vk in $KEYS.Keys) {
        $down = (([SensorNative]::GetAsyncKeyState($vk)) -band 0x8000) -ne 0
        if ($down -and -not $prevKey[$vk]) { EmitJson @{ t = 'key'; k = $KEYS[$vk] } }
        $prevKey[$vk] = $down
    }
    # ---- Full key scan (any key incl. arrows/function/edit keys): keystroke counting ----
    # Scans every VK (0x08 backspace .. 0xFE); 0x01..0x06 are mouse buttons covered by btn events
    for ($vk = 0x08; $vk -le 0xFE; $vk++) {
        $down = (([SensorNative]::GetAsyncKeyState($vk)) -band 0x8000) -ne 0
        if ($down -and -not $prevAll[$vk]) { EmitJson @{ t = 'keystroke'; vk = $vk } }
        $prevAll[$vk] = $down
    }
    # ---- Mouse buttons ----
    foreach ($vk in $MOUSE.Keys) {
        $down = (([SensorNative]::GetAsyncKeyState($vk)) -band 0x8000) -ne 0
        if ($down -and -not $prevBtn[$vk]) { EmitJson @{ t = 'btn'; k = $MOUSE[$vk] } }
        $prevBtn[$vk] = $down
    }
    # ---- Cursor position (emit only on change, throttled to ~100 ms) ----
    $tick++
    if ($tick % 2 -eq 1) {
        $pt = New-Object SensorNative+POINT
        [SensorNative]::GetCursorPos([ref]$pt) | Out-Null
        if ($pt.X -ne $lastPosX -or $pt.Y -ne $lastPosY) {
            $lastPosX = $pt.X; $lastPosY = $pt.Y
            [Console]::Out.WriteLine('{"t":"pos","x":' + $pt.X + ',"y":' + $pt.Y + '}')
        }
    }

    $now = [Environment]::TickCount
    if ($now - $lastCpuAt -ge 3000) {
        $lastCpuAt = $now
        $cpu = Get-CpuLoad
        if ($cpu -ge 0) { EmitJson @{ t = 'cpu'; p = $cpu } }
    }
    if ($now - $lastMediaAt -ge 3000) {
        $lastMediaAt = $now
        $m = Get-MediaState
        EmitJson @{ t = 'media'; s = [bool]$m.s; app = $m.app; music = [bool]$m.music }
    }

    Start-Sleep -Milliseconds $pollMs
}
