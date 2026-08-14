# Reads a base64 PNG on stdin, prints recognised text on stdout.
# Uses Windows' built-in OCR (Windows.Media.Ocr). No network, no model files,
# no temp file - the image is decoded straight from an in-memory stream.
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

[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataWriter, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

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

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No OCR engine available for your Windows display languages.' }

$res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

# Emit one fragment per recognised line with its box, and let ocr.js put them in
# reading order. $res.Text will not do it: on a code block the engine returns
# "const a", "const b", "const c", "= a.map(n n * 2)" as separate lines and
# stringifies them in its own order, so the left of every row arrives before the
# right of any of them.
$frags = foreach ($line in $res.Lines) {
    if ($line.Words.Count -eq 0) { continue }
    $tops = @($line.Words | ForEach-Object { $_.BoundingRect.Y })
    $bottoms = @($line.Words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height })
    [pscustomobject]@{
        top    = ($tops | Measure-Object -Minimum).Minimum
        bottom = ($bottoms | Measure-Object -Maximum).Maximum
        left   = ($line.Words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
        text   = (($line.Words | ForEach-Object { $_.Text }) -join ' ')
    }
}

[Console]::Out.Write((ConvertTo-Json -Compress -Depth 3 -InputObject @($frags)))
