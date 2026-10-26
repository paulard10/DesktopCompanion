# Read-only Windows TTS voice inventory for M1.8B.0 research. Does not install voices.
$ErrorActionPreference = 'Stop'

Write-Output '=== System.Speech.Synthesis (SAPI) ==='
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices()
Write-Output ("Count: " + $voices.Count)
foreach ($entry in $voices) {
  $v = $entry.VoiceInfo
  [PSCustomObject]@{
    Api = 'System.Speech'
    Name = $v.Name
    Culture = $v.Culture.Name
    Gender = $v.Gender.ToString()
    Age = $v.Age.ToString()
    Description = $v.Description
  } | ConvertTo-Json -Compress
}

Write-Output '=== Registry tokens (OneCore) ==='
$oneCore = 'HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens'
if (Test-Path $oneCore) {
  Get-ChildItem $oneCore | ForEach-Object { Write-Output ("OneCore: " + $_.PSChildName) }
} else {
  Write-Output 'OneCore key missing'
}

Write-Output '=== Registry tokens (legacy Speech) ==='
$legacy = 'HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens'
if (Test-Path $legacy) {
  Get-ChildItem $legacy | ForEach-Object { Write-Output ("Legacy: " + $_.PSChildName) }
} else {
  Write-Output 'Legacy key missing'
}
