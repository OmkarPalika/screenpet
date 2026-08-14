# Reads a base64 JPEG on stdin, prints how many faces are in it. That is the
# entire output: one integer.
#
# Uses Windows' own face detector (Windows.Media.FaceAnalysis), which ships with
# Windows 10 and later. No model file, no download, no network, and no temp file
# - the frame is decoded from an in-memory stream exactly the way ocr.ps1 does
# it, and is gone when the process exits a second later.
#
# What this cannot do is as important as what it can. Windows.Media.FaceAnalysis
# detects; it has no identify, no compare, and no embedding. There is no API here
# that could tell one person from another even if this script wanted to, and it
# does not: it counts rectangles and prints a number.
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

[Windows.Media.FaceAnalysis.FaceDetector, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

if (-not [Windows.Media.FaceAnalysis.FaceDetector]::IsSupported) {
    throw 'This copy of Windows has no face detector.'
}

$bytes = [Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim())

$stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
$writer = New-Object Windows.Storage.Streams.DataWriter $stream
$writer.WriteBytes($bytes)
Await ($writer.StoreAsync()) ([uint32]) | Out-Null
Await ($writer.FlushAsync()) ([bool]) | Out-Null
$writer.DetachStream() | Out-Null
$stream.Seek(0)

$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

# The detector takes a short list of pixel formats and Gray8 is on it, which is
# also the format that throws away the most: no colour reaches the detector at
# all.
$gray = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8)
$bitmap.Dispose()

$detector = Await ([Windows.Media.FaceAnalysis.FaceDetector]::CreateAsync()) ([Windows.Media.FaceAnalysis.FaceDetector])
$faces = Await ($detector.DetectFacesAsync($gray)) ([System.Collections.Generic.IList[Windows.Media.FaceAnalysis.DetectedFace]])
$gray.Dispose()

# One integer. Not the boxes, not the sizes, not where in the frame - none of
# which the pet has any use for, and all of which would be more than it needs.
[Console]::Out.Write($faces.Count)
