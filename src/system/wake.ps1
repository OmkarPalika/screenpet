# Listens for one phrase and nothing else.
#
# The important part is the grammar. This recogniser is loaded with a Choices
# list containing exactly the wake phrases, which means it is not a transcriber
# that happens to be looking for a word - it is structurally incapable of
# recognising anything else. Say your card number in front of it and there is no
# code path that could produce those digits: the only thing it can ever emit is
# the line WAKE.
#
# Everything is local. System.Speech is the SAPI engine that ships with Windows,
# the audio never leaves the machine, and this script has no network access of
# any kind. It is the same engine listen.ps1 uses, in its narrowest possible
# configuration.
#
# It runs for as long as the setting is on, which is the honest cost of a wake
# word and the reason the setting ships off.

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine

$choices = New-Object System.Speech.Recognition.Choices
$choices.Add('hey pet')
$choices.Add('hello pet')
$choices.Add('okay pet')
$choices.Add('wake up pet')

$builder = New-Object System.Speech.Recognition.GrammarBuilder
$builder.Append($choices)
$rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar $builder))

$rec.SetInputToDefaultAudioDevice()

# Same floor as listen.ps1: a constrained grammar will happily match room noise
# to its nearest phrase, and a pet that wakes up at the fridge is worse than one
# that needs saying twice.
$floor = 0.6
if ($env:SCREENPET_WAKE_CONFIDENCE) { $floor = [double]$env:SCREENPET_WAKE_CONFIDENCE }

Write-Output 'READY'
[Console]::Out.Flush()

$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -SourceIdentifier Woke | Out-Null

while ($true) {
    $event = Wait-Event -SourceIdentifier Woke
    $result = $event.SourceEventArgs.Result
    Remove-Event -EventIdentifier $event.EventIdentifier
    if ($result.Confidence -ge $floor) {
        # The only thing this process ever says. Not the phrase, not a
        # transcript, not a confidence - one word meaning "someone said it".
        Write-Output 'WAKE'
        [Console]::Out.Flush()
    }
}
