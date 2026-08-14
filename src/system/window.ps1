# Where the window you are working in is, so the pet can read that instead of
# the whole screen. On a wide monitor the whole screen is your editor, your
# browser, a chat window and the taskbar all shredded into one column of text,
# and the model has to work out which of it you meant.
#
# A rectangle and nothing else comes back. Not the title, not the process, not
# the class - the pet has no business knowing which application you are in, and
# a rectangle is all that is needed to crop a screenshot. Same reasoning as
# dnd.ps1, which asks Windows for one integer rather than for a window list.
#
# Physical pixels, which is why SetProcessDPIAware is called first: without it
# Windows lies to this process about every coordinate on a scaled display, and
# the crop lands somewhere else entirely.
#
# -Watch stays running and prints the rectangle again every time the foreground
# window changes, so the pet can notice you moving between windows. One process
# for the session rather than one per look: starting PowerShell is ~400ms and
# doing that on a timer is most of the reason the pet did not do this before.

param(
  [switch]$Watch,
  # A glance is the whole reaction, so this only has to beat "did you see that".
  [int]$PollMs = 400
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Screenpet -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();

[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);

[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hWnd);

[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();

public struct RECT { public int Left, Top, Right, Bottom; }
'@

[void][Screenpet.Win]::SetProcessDPIAware()

function Get-Rect($hwnd) {
  if ($hwnd -eq [System.IntPtr]::Zero) { throw 'No window is in the foreground.' }
  # Minimised windows still have a rectangle, and it is off in the corner of
  # nowhere. Cropping to it would hand the model a strip of desktop.
  if ([Screenpet.Win]::IsIconic($hwnd)) { throw 'The foreground window is minimised.' }

  $r = New-Object Screenpet.Win+RECT
  if (-not [Screenpet.Win]::GetWindowRect($hwnd, [ref]$r)) { throw 'Could not measure the window.' }

  '{{"x":{0},"y":{1},"w":{2},"h":{3}}}' -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)
}

if (-not $Watch) {
  Write-Output (Get-Rect ([Screenpet.Win]::GetForegroundWindow()))
  return
}

# The app kills this on the way out, but it cannot do that if it crashed or was
# killed itself - and what would be left behind is a process polling the
# foreground window forever with nothing listening, until the machine reboots.
# The handle is taken once and held, so a recycled process id cannot make this
# outlive its parent by pointing at somebody else's.
$parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$parent = try { [System.Diagnostics.Process]::GetProcessById($parentId) } catch { $null }

# The handle is compared, not the rectangle: typing in a window moves nothing,
# and dragging one around is not you changing what you are looking at.
$last = [System.IntPtr]::Zero
while ($true) {
  if ($parent -and $parent.HasExited) { break }
  $hwnd = [Screenpet.Win]::GetForegroundWindow()
  if ($hwnd -ne $last) {
    $last = $hwnd
    # A window that vanished between the two calls, or was minimised on the way
    # out, is nothing to say and certainly nothing to die over. Waiting for the
    # next switch is the right answer to every failure here.
    try {
      Write-Output (Get-Rect $hwnd)
      [Console]::Out.Flush()
    } catch { }
  }
  Start-Sleep -Milliseconds $PollMs
}
