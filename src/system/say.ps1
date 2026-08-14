# The pet's voice, as audio rather than as sound.
#
# Windows will happily speak a sentence for you, and until now that is what this
# app did - the renderer handed a line to SpeechSynthesis and the operating
# system made a noise. The trouble is that Chromium gives nobody access to the
# audio of an utterance, so the pet was stuck with whatever Microsoft David
# sounds like, and Microsoft David sounds like a train station.
#
# This synthesises to a buffer instead and prints it as base64, so the renderer
# can put it through a filter chain and come out the other side sounding like a
# small machine that likes you. See robot.js.
#
# Nothing is written to disk. A WAV of everything the pet has said to you is
# exactly the kind of file this app promises not to leave lying around, and a
# MemoryStream costs nothing to use instead.
#
# One process for the session, like window.ps1 -Watch: starting PowerShell is
# ~400ms and loading the speech engine another ~150ms, and paying that before
# every sentence would be a pet that pauses to think about how to say hello.
#
# Protocol, one line each way:
#   in   {"text":"...","rate":-2}
#   out  base64 of a RIFF WAV, or ERROR <message>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName System.Speech

# SetOutputToWaveStream rather than SetOutputToAudioStream, which sounds like
# the more precise of the two and is the wrong one: it writes raw PCM with no
# RIFF header, and decodeAudioData refuses it. This writes a complete WAV, and
# already at 22050Hz 16-bit mono - plenty for a voice, and a quarter of the
# bytes of CD stereo, every one of which crosses a pipe and then an IPC boundary
# as base64.

# Long enough for anything the pet says - the bubble caps well below this - and
# short enough that a pasted wall of text cannot turn into a minute of audio.
$maxChars = 600

Write-Output 'READY'
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  # The pipe closed: the app quit, or died. Either way there is nobody to talk to.
  if ($null -eq $line) { break }
  if ([string]::IsNullOrWhiteSpace($line)) { continue }

  try {
    $req = $line | ConvertFrom-Json
    $text = [string]$req.text
    if ([string]::IsNullOrWhiteSpace($text)) { throw 'nothing to say' }
    if ($text.Length -gt $maxChars) { $text = $text.Substring(0, $maxChars) }

    # A new synthesiser per line, because the output binds to one stream and
    # rebinding a used one is how you get half of the last sentence on the front
    # of this one.
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $stream = New-Object System.IO.MemoryStream
    try {
      $rate = [int]$req.rate
      if ($rate -lt -10) { $rate = -10 }
      if ($rate -gt 10) { $rate = 10 }
      $synth.Rate = $rate
      $synth.SetOutputToWaveStream($stream)
      # Speak, never SpeakSsml: the text is a model's output, and SSML is markup
      # that would let a sentence off the internet drive the speech engine.
      $synth.Speak($text)
      $synth.SetOutputToNull()
      Write-Output ([Convert]::ToBase64String($stream.ToArray()))
    } finally {
      $synth.Dispose()
      $stream.Dispose()
    }
  } catch {
    # One line, no stack trace: the caller falls back to the system voice and
    # the person hears their pet talk rather than an error about talking.
    Write-Output ('ERROR ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
  }
  [Console]::Out.Flush()
}
