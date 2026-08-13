# Taps one Windows media key, system-wide, through the same path the keyboard
# driver uses. Whatever is playing handles it - Spotify, a browser tab, the
# Groove app - and this script never learns which, never asks, and gets nothing
# back. It is one keystroke, not a music integration.
#
# ponytail: keybd_event rather than SendInput. Deprecated for a decade and still
# the shortest thing that works for these keys; move to SendInput if a future
# Windows stops honouring it.
param([int]$Code)

$ErrorActionPreference = 'Stop'

# 0xAD-0xB3 is exactly the volume and media transport block: mute, volume down,
# volume up, next, previous, stop, play/pause. A range check rather than trust,
# because this presses real keys on a real machine and the caller is a regex.
if ($Code -lt 0xAD -or $Code -gt 0xB3) {
    throw ('Refusing to press key 0x{0:X}.' -f $Code)
}

Add-Type -Namespace Screenpet -Name Key -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@

[Screenpet.Key]::keybd_event([byte]$Code, 0, 0, [System.UIntPtr]::Zero) # down
[Screenpet.Key]::keybd_event([byte]$Code, 0, 2, [System.UIntPtr]::Zero) # up (KEYEVENTF_KEYUP)
