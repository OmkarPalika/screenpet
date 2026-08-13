# Asks Windows whether now is a good time to speak up. This is the same question
# Windows asks itself before showing a toast, so the pet shuts up in exactly the
# situations the OS already considers off limits: a full screen game, a
# presentation, Focus Assist / Do Not Disturb.
#
# Nothing about the foreground app comes back - not its name, not its title, not
# its window. One integer describing the machine's mood, which is all that is
# needed to decide whether to keep quiet, and the least that could be asked for.
#
# ponytail: shell32 rather than enumerating windows and comparing rectangles.
# The rectangle version needs a window list, which is both more code and more
# information about what you are running than this has any business holding.

$ErrorActionPreference = 'Stop'

Add-Type -Namespace Screenpet -Name Shell -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern int SHQueryUserNotificationState(out int state);
'@

$state = 0
$hr = [Screenpet.Shell]::SHQueryUserNotificationState([ref]$state)
if ($hr -ne 0) {
    throw ('SHQueryUserNotificationState failed: 0x{0:X}' -f $hr)
}

Write-Output $state
