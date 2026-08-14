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

$hwnd = [Screenpet.Win]::GetForegroundWindow()
if ($hwnd -eq [System.IntPtr]::Zero) { throw 'No window is in the foreground.' }
# Minimised windows still have a rectangle, and it is off in the corner of
# nowhere. Cropping to it would hand the model a strip of desktop.
if ([Screenpet.Win]::IsIconic($hwnd)) { throw 'The foreground window is minimised.' }

$r = New-Object Screenpet.Win+RECT
if (-not [Screenpet.Win]::GetWindowRect($hwnd, [ref]$r)) { throw 'Could not measure the window.' }

Write-Output ('{{"x":{0},"y":{1},"w":{2},"h":{3}}}' -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
