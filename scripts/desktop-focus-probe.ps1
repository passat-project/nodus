# External keyboard-focus probe for the Nodus shell (#820, from #709).
#
# The shell has no focus diagnostics we can read from a script, so we measure
# from another process via GetGUIThreadInfo: which window REALLY receives keys
# (hwndFocus) and which top-level window it belongs to. Works for the installed
# shell and for the local beta build (-ExeFilter picks the process).
#
# Usage (Windows PowerShell 5.1, no admin):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\desktop-focus-probe.ps1
#   powershell ... -File scripts\desktop-focus-probe.ps1 -ExeFilter '*\target\debug\*' -Samples 5
#
# ExeFilter defaults:
#   installed shell : *\AppData\Local\Nodus\*
#   local beta      : *\apps\desktop\src-tauri\target\debug\*
#
# Verdicts:
#   focus_in_main        - keyboard is in the main window, all good
#   focus_in_app_popup   - keyboard is in ANOTHER window of the same app (a popup) = bug
#   focus_none           - focus lost (queue has no focus window)
#   foreground_foreign   - user is in another application, nothing to measure
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads a .ps1 without
# a UTF-8 BOM as ANSI and mangles non-ASCII text (see docs/gotchas/desktop.md).
param(
  [string]$ExeFilter = '*\AppData\Local\Nodus\*',
  [int]$Samples = 5,
  [int]$IntervalMs = 1000
)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class FocusProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize;
    public int flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public int rcLeft, rcTop, rcRight, rcBottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);

  public static string ClassOf(IntPtr hwnd) {
    var sb = new StringBuilder(256);
    GetClassNameW(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static string TitleOf(IntPtr hwnd) {
    var sb = new StringBuilder(256);
    GetWindowTextW(hwnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static List<IntPtr> WindowsOf(uint pid) {
    var found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hwnd, IntPtr _) {
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (owner == pid) found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string RectOf(IntPtr hwnd) {
    RECT r;
    if (!GetWindowRect(hwnd, out r)) return "?";
    return string.Format("{0},{1} {2}x{3}", r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
  }

  public static int AreaOf(IntPtr hwnd) {
    RECT r;
    if (!GetWindowRect(hwnd, out r)) return 0;
    return (r.Right - r.Left) * (r.Bottom - r.Top);
  }

  public static string Snapshot(IntPtr main, uint pid) {
    // GetWindowThreadProcessId RETURN value is the thread id; the out param is
    // the process id. Passing the pid here makes GetGUIThreadInfo fail.
    uint ownerPid;
    uint thread = GetWindowThreadProcessId(main, out ownerPid);
    var info = new GUITHREADINFO();
    info.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(thread, ref info)) {
      return "GetGUIThreadInfo failed thread=" + thread + " err=" + Marshal.GetLastWin32Error();
    }

    IntPtr fg = GetForegroundWindow();
    IntPtr focus = info.hwndFocus;
    IntPtr root = focus == IntPtr.Zero ? IntPtr.Zero : GetAncestor(focus, 2 /* GA_ROOT */);
    uint rootPid = 0;
    if (root != IntPtr.Zero) GetWindowThreadProcessId(root, out rootPid);

    string verdict;
    if (fg == IntPtr.Zero) verdict = "foreground_foreign";
    else if (focus == IntPtr.Zero) verdict = "focus_none";
    else if (root == main) verdict = "focus_in_main";
    else if (rootPid == pid) verdict = "focus_in_app_popup";
    else verdict = "foreground_foreign";

    return string.Format(
      "fg=0x{0:X} active=0x{1:X} focus=0x{2:X}({3}) root=0x{4:X}({5}) rootPid={6} rect={7} | VERDICT={8}",
      fg.ToInt64(), info.hwndActive.ToInt64(), focus.ToInt64(), ClassOf(focus),
      root.ToInt64(), ClassOf(root), rootPid, RectOf(root), verdict);
  }
}
'@

# ExeFilter may pick several processes (installed shell + local build).
$targets = Get-Process nodus-desktop -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like $ExeFilter }
if (-not $targets) {
  Write-Output "probe: no process matches $ExeFilter"
  exit 2
}

foreach ($proc in $targets) {
  $procId = [uint32]$proc.Id
  $windows = [FocusProbe]::WindowsOf($procId)
  # Main window = the largest visible one: popups are 360x~90, main is ~1280x800.
  $main = [IntPtr]::Zero
  $best = 0
  foreach ($hwnd in $windows) {
    if (-not [FocusProbe]::IsWindowVisible($hwnd)) { continue }
    $area = [FocusProbe]::AreaOf($hwnd)
    if ($area -gt $best) { $best = $area; $main = $hwnd }
  }
  Write-Output ("=== PID {0} {1} ===" -f $proc.Id, $proc.Path)
  $classes = @()
  foreach ($hwnd in $windows) {
    $classes += ("0x{0:X}({1})" -f $hwnd.ToInt64(), [FocusProbe]::ClassOf($hwnd))
  }
  Write-Output ("windows: " + ($classes -join " "))
  if ($main -eq [IntPtr]::Zero) {
    Write-Output "probe: process has no visible windows"
    continue
  }
  Write-Output ("main: 0x{0:X} class={1} title={2} rect={3}" -f $main.ToInt64(), [FocusProbe]::ClassOf($main), [FocusProbe]::TitleOf($main), [FocusProbe]::RectOf($main))
  for ($i = 1; $i -le $Samples; $i++) {
    $line = [FocusProbe]::Snapshot($main, $procId)
    Write-Output ("  sample " + $i + ": " + $line)
    if ($i -lt $Samples) { Start-Sleep -Milliseconds $IntervalMs }
  }
}
