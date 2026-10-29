param([Parameter(Mandatory=$true)][string]$ControlRoot)
$ErrorActionPreference = 'Stop'
$taskHandles = @()
$taskProcess = $null
try {
  $taskRoot = [IO.Path]::GetFullPath($ControlRoot)
  $taskTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($taskRoot) -ne $taskTemp -or -not [IO.Path]::GetFileName($taskRoot).StartsWith('desktop-companion-local-check-')) { throw 'Invalid control root' }
  if ((Get-Item -LiteralPath $taskRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Invalid control root' }
  $taskControl = Get-Content -LiteralPath (Join-Path $taskRoot 'control.json') -Raw | ConvertFrom-Json
  if ($taskControl.mode -notin @('dummy','wrong-dummy','real107','real110')) { throw 'Invalid mode' }
  $taskIsReal = $taskControl.mode -in @('real107','real110')
  $taskProfile = if ($taskIsReal) { Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'desktop-companion' } else { Join-Path $taskRoot 'profile-a' }
  if (-not (Test-Path -LiteralPath (Join-Path $taskProfile 'Local State') -PathType Leaf)) { throw 'No existing crypto profile' }
  foreach ($taskDir in @($taskProfile,(Join-Path $taskProfile 'companion'))) {
    if ((Test-Path -LiteralPath $taskDir) -and ((Get-Item -LiteralPath $taskDir).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse directory refused' }
  }
  $taskBefore = @{}
  foreach ($taskRelative in @('Local State','companion\provider-settings.json','companion\qwen-key.bin')) {
    $taskFile = Join-Path $taskProfile $taskRelative
    if (Test-Path -LiteralPath $taskFile) {
      $taskInfo = Get-Item -LiteralPath $taskFile
      if ($taskInfo.PSIsContainer -or ($taskInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Not a regular record' }
      # Read-only kernel handles deny writing, replacement and deletion, including native writes.
      # No Read/ReadByte/CopyTo call: this supervisor never sees credential bytes.
      $taskHandles += [IO.File]::Open($taskFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $taskBefore[$taskRelative] = @($taskInfo.Length,$taskInfo.LastWriteTimeUtc.Ticks)
    } else { $taskBefore[$taskRelative] = $null }
  }
  $taskStart = New-Object Diagnostics.ProcessStartInfo
  $taskStart.FileName = Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe'
  $taskStart.Arguments = '"' + (Join-Path $taskRoot 'normal-package') + '"'
  if (-not $taskIsReal) {
    $taskSelected = if ($taskControl.mode -eq 'wrong-dummy') { 'profile-b' } else { 'profile-a' }
    $taskStart.Arguments += ' "--user-data-dir=' + (Join-Path $taskRoot $taskSelected) + '"'
  }
  $taskStart.WorkingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $taskStart.UseShellExecute = $false
  $taskStart.CreateNoWindow = $true
  $taskStart.RedirectStandardOutput = $true
  $taskStart.RedirectStandardError = $true
  $taskStart.EnvironmentVariables.Clear()
  foreach ($taskName in @('SystemRoot','WINDIR','TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')) {
    $taskValue = [Environment]::GetEnvironmentVariable($taskName)
    if ($null -ne $taskValue) { $taskStart.EnvironmentVariables[$taskName] = $taskValue }
  }
  $taskStart.EnvironmentVariables['DESKTOP_COMPANION_LOCAL_CHECK_ROOT'] = $taskRoot
  $taskStart.EnvironmentVariables['DESKTOP_COMPANION_LOCAL_CHECK_MODE'] = $taskControl.mode
  $taskProcess = [Diagnostics.Process]::Start($taskStart)
  $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
  $taskErr = $taskProcess.StandardError.ReadToEndAsync()
  if (-not $taskProcess.WaitForExit(20000)) { $taskProcess.Kill(); throw 'Diagnostic timed out' }
  $taskResult = $taskOut.Result | ConvertFrom-Json
  if ($taskProcess.ExitCode -ne 0) { throw 'Diagnostic failed' }
  $taskUnchanged = $true
  foreach ($taskRelative in $taskBefore.Keys) {
    $taskFile = Join-Path $taskProfile $taskRelative
    if ($null -eq $taskBefore[$taskRelative]) { if (Test-Path -LiteralPath $taskFile) { $taskUnchanged = $false } }
    else {
      $taskInfo = Get-Item -LiteralPath $taskFile
      if ($taskInfo.Length -ne $taskBefore[$taskRelative][0] -or $taskInfo.LastWriteTimeUtc.Ticks -ne $taskBefore[$taskRelative][1]) { $taskUnchanged = $false }
    }
  }
  $taskAllowed = @('AVAILABLE_LOCALLY','CREDENTIAL_ENTRY_MISSING','CREDENTIAL_DECRYPTION_FAILED','SECURE_STORAGE_UNAVAILABLE','CREDENTIAL_NAMESPACE_MISMATCH','APP_CONTEXT_INVALID','PROVIDER_CONFIGURATION_INCOMPLETE','CREDENTIAL_READ_ERROR','UNVERIFIED_SAFE_STOP')
  if ($taskResult.outcome -notin $taskAllowed) { throw 'Invalid result' }
  $taskAttempted = if ($null -eq $taskResult.retrievalAttempted) { $null } else { $taskResult.retrievalAttempted -eq $true }
  [pscustomobject]@{outcome=$taskResult.outcome; retrievalAttempted=$taskAttempted; contextMatched=($taskResult.contextMatched -eq $true); encryptionReady=($taskResult.encryptionReady -eq $true); guardReady=($taskResult.guardReady -eq $true); networkAttempts=[int]$taskResult.networkAttempts; sessionRequestsBlocked=[int]$taskResult.sessionRequestsBlocked; guardSelfTests=[int]$taskResult.guardSelfTests; readLocksHeld=$true; protectedFilesUnchanged=$taskUnchanged; childClosed=$true; stderrPresent=($taskErr.Result.Length -gt 0)} | ConvertTo-Json -Compress
} catch {
  # Unknown child output is never a reason to retry the real attempt.
  '{"outcome":"UNVERIFIED_SAFE_STOP","retrievalAttempted":null,"readLocksHeld":false,"protectedFilesUnchanged":null,"childClosed":true}'
} finally {
  foreach ($taskHandle in $taskHandles) { $taskHandle.Dispose() }
  if ($null -ne $taskProcess) { $taskProcess.Dispose() }
}
