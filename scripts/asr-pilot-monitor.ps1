param([Parameter(Mandatory = $true)][int]$TargetPid, [int]$IntervalMs = 100)

$peakWorkingSetBytes = 0L
$peakPrivateBytes = 0L
$lastCpuMs = 0.0
$sampleCount = 0
while ($true) {
  try {
    $target = [System.Diagnostics.Process]::GetProcessById($TargetPid)
    $target.Refresh()
    $peakWorkingSetBytes = [Math]::Max($peakWorkingSetBytes, $target.PeakWorkingSet64)
    $peakPrivateBytes = [Math]::Max($peakPrivateBytes, $target.PrivateMemorySize64)
    $lastCpuMs = $target.TotalProcessorTime.TotalMilliseconds
    $sampleCount++
  } catch { break }
  Start-Sleep -Milliseconds $IntervalMs
}
@{
  peakWorkingSetBytes = $peakWorkingSetBytes
  peakPrivateBytes = $peakPrivateBytes
  cpuTimeMs = [Math]::Round($lastCpuMs)
  sampleCount = $sampleCount
} | ConvertTo-Json -Compress
