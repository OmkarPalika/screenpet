# Reads one spoken phrase from the default microphone and prints it on stdout.
# Uses Windows' own recogniser (System.Speech). The desktop recogniser runs
# on-device: no network, no model download, no audio written to disk - the
# engine reads the capture device directly and only the recognised text is
# printed. Returns nothing at all if the timeout passes without speech.
#
# ponytail: SAPI dictation, not whisper. It is already installed and it is
# offline, which is what this app needs; swap in whisper.cpp if accuracy on
# technical words becomes the complaint.
#
# MinConfidence is a calibration knob, not a constant to tidy away. Measured on
# this machine: three seconds of an ordinary room with nobody speaking came back
# as "Note to the audit got a" at 0.029 overall, and dictation returns that sort
# of thing confidently whenever there is audio playing nearby. 0.30 clears the
# measured noise floor by an order of magnitude. It has NOT been tuned against
# real speech on a quiet headset - if the pet starts answering "I did not catch
# that" to a perfectly clear sentence, this is the number to lower.
param([int]$Seconds = 8, [double]$MinConfidence = 0.30)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if ($installed.Count -eq 0) {
    throw 'Windows has no speech recogniser installed. Add one under Settings > Time & language > Speech.'
}

# Prefer one that matches the display language; the engine picked by the
# parameterless constructor is whatever the input language happens to be, which
# on a multi-language machine is not always the one being spoken.
$want = [System.Globalization.CultureInfo]::CurrentUICulture.Name
$pick = $installed | Where-Object { $_.Culture.Name -eq $want } | Select-Object -First 1
if ($null -eq $pick) { $pick = $installed | Select-Object -First 1 }

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $pick
try {
    $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))

    try {
        $engine.SetInputToDefaultAudioDevice()
    } catch {
        throw 'No microphone available. Check it is plugged in, and that Windows lets desktop apps use it.'
    }

    # Long enough to finish a sentence, short enough that a cough does not hold
    # the microphone open.
    $engine.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)

    $result = $engine.Recognize([TimeSpan]::FromSeconds($Seconds))
    # Silence is $null; noise is a confident-looking sentence with a terrible
    # score behind it. Both mean nothing was said, and both print nothing.
    if ($null -ne $result -and $result.Confidence -ge $MinConfidence) {
        [Console]::Out.Write($result.Text)
    }
} finally {
    $engine.Dispose()
}
