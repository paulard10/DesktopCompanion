# Measures System.Speech playback timing for research. Does not modify the app.
param(
  [string]$Culture = 'es-ES',
  [string]$Text = 'Hola. Soy tu compañero de escritorio.'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq $Culture } | Select-Object -First 1
if (-not $voice) {
  Write-Error "No voice for culture $Culture"
}
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = 0
$synth.Volume = 100
$started = [Diagnostics.Stopwatch]::StartNew()
$synth.Speak($Text)
$started.Stop()
[PSCustomObject]@{
  Api = 'System.Speech'
  Voice = $voice.VoiceInfo.Name
  Culture = $voice.VoiceInfo.Culture.Name
  TextLength = $Text.Length
  TotalMs = $started.ElapsedMilliseconds
} | ConvertTo-Json -Compress
