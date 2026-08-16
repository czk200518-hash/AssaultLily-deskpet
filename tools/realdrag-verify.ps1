# Real-mouse drag verifier for LilyPet (ASCII only - PS5.1 safe)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/realdrag-verify.ps1 [-Phase old|new]
# Flow:
#   1. Start the pet with --debug-shot realdrag (logs the model center in physical screen px)
#   2. Poll debug.log for the target coordinates
#   3. Drive the REAL mouse: SetCursorPos + mouse_event down -> drag ~1.5s -> up
#   4. Wait for the app to exit, then print all [realdrag] measurement lines
param(
  [string]$Phase = "new"
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $root 'debug.log'
$runOut = Join-Path $root ("tools/realdrag-{0}-out.txt" -f $Phase)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
}
'@
try { [RMouse]::SetProcessDpiAwareness(2) | Out-Null } catch { "DPI awareness failed: $_" }

if (Test-Path $logPath) { Remove-Item $logPath -Force }

# 1. Start the pet (realdrag mode quits by itself after ~15.5s)
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$proc = Start-Process -FilePath $exe -ArgumentList @('.', '--debug-shot', 'realdrag') `
  -WorkingDirectory $root -RedirectStandardOutput $runOut -RedirectStandardError "$runOut.err" -PassThru
"PID=$($proc.Id) started, waiting for target..."

# 2. Poll debug.log for the model-center physical coordinates
$target = $null
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $logPath) {
    $line = Get-Content $logPath -Encoding UTF8 -ErrorAction SilentlyContinue |
      Select-String -Pattern '\[realdrag\].*=\((\d+),(\d+)\)' | Select-Object -Last 1
    if ($line) {
      if ($line.Matches[0].Groups.Count -ge 3) {
        $target = @([int]$line.Matches[0].Groups[1].Value, [int]$line.Matches[0].Groups[2].Value)
        break
      }
    }
  }
  Start-Sleep -Milliseconds 250
}
if (-not $target) { "No target found, exit code: $($proc.ExitCode)"; exit 1 }
"Target physical = ($($target[0]),$($target[1]))"

# 3. Drive the real mouse: down -> drag -> up
$x = $target[0]; $y = $target[1]
[RMouse]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 300
[RMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # LEFTDOWN

# Drag path: two rectangles + two diagonals, 8ms per step, ~1.5s total
$steps = New-Object System.Collections.Generic.List[object]
for ($i = 1; $i -le 30; $i++) { $steps.Add(@(($x + 10 * $i), $y)) }
for ($i = 1; $i -le 20; $i++) { $steps.Add(@(($x + 300), ($y + 10 * $i))) }
for ($i = 1; $i -le 30; $i++) { $steps.Add(@(($x + 300 - 10 * $i), ($y + 200))) }
for ($i = 1; $i -le 20; $i++) { $steps.Add(@($x, ($y + 200 - 10 * $i))) }
for ($i = 1; $i -le 40; $i++) { $steps.Add(@(($x + 8 * $i), ($y + 8 * $i))) }
for ($i = 1; $i -le 40; $i++) { $steps.Add(@(($x + 320 - 8 * $i), ($y + 320 - 8 * $i))) }
foreach ($p in $steps) { [RMouse]::SetCursorPos([int]$p[0], [int]$p[1]) | Out-Null; Start-Sleep -Milliseconds 8 }
Start-Sleep -Milliseconds 120
[RMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # LEFTUP
"Drag done ($($steps.Count) steps), waiting for pet to exit..."

# 4. Wait for exit and print the measurement log
$proc.WaitForExit(30000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill(); "Timed out, killed" }
Start-Sleep -Milliseconds 300
"===== realdrag measurements ($Phase) ====="
if (Test-Path $logPath) {
  Get-Content $logPath -Encoding UTF8 | Select-String -Pattern '\[realdrag\]'
} else {
  "debug.log missing"
}
