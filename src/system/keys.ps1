param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('protect', 'unprotect')]
  [string]$Mode
)

# API keys at rest. DPAPI with CurrentUser scope, so the blob on disk is only
# readable by the Windows account that wrote it - copying keys.json to another
# machine, or another user on this one, gets an unreadable lump.
#
# The secret arrives on stdin and never on the command line: arguments are
# visible to anything that can list processes, and that would make the storage
# pointless.
#
# This is not a vault. Anything running as you can ask DPAPI to unprotect it,
# exactly as this script does. It stops the file being useful on its own, which
# is the threat that actually applies to a config file in a user profile.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Security

$payload = [Console]::In.ReadToEnd().Trim()
if ([string]::IsNullOrEmpty($payload)) { throw 'Nothing on stdin.' }

$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser

if ($Mode -eq 'protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $blob = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  [Console]::Out.Write([Convert]::ToBase64String($blob))
} else {
  $blob = [Convert]::FromBase64String($payload)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect($blob, $null, $scope)
  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
}
