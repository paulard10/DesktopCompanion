import { execFile } from 'node:child_process';
import path from 'node:path';

// Fixed Windows-only, one-shot DWM readiness probe. No capture, titles, input,
// shell, user arguments or installed native module. Never used at startup/smoke.
const probe = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class CompositionReady {
 [StructLayout(LayoutKind.Sequential, Pack=1)] public struct Ratio { public uint n,d; }
 [StructLayout(LayoutKind.Sequential, Pack=1)] public struct Timing {
  public uint cbSize; public Ratio rateRefresh; public ulong qpcRefreshPeriod;
  public Ratio rateCompose; public ulong qpcVBlank,cRefresh; public uint cDXRefresh;
  public ulong qpcCompose,cFrame; public uint cDXPresent;
  public ulong cRefreshFrame,cFrameSubmitted; public uint cDXPresentSubmitted;
  public ulong cFrameConfirmed; public uint cDXPresentConfirmed;
  public ulong cRefreshConfirmed; public uint cDXRefreshConfirmed;
  public ulong cFramesLate; public uint cFramesOutstanding;
  public ulong cFrameDisplayed,qpcFrameDisplayed,cRefreshFrameDisplayed,cFrameComplete,qpcFrameComplete;
  public ulong cFramePending,qpcFramePending,cFramesDisplayed,cFramesComplete,cFramesPending,cFramesAvailable;
  public ulong cFramesDropped,cFramesMissed,cRefreshNextDisplayed,cRefreshNextPresented,cRefreshesDisplayed;
  public ulong cRefreshesPresented,cRefreshStarted,cPixelsReceived,cPixelsDrawn,cBuffersEmpty;
 }
 [DllImport("dwmapi.dll")] static extern int DwmGetCompositionTimingInfo(IntPtr hwnd, ref Timing timing);
 [DllImport("dwmapi.dll")] static extern int DwmFlush();
 public static bool Wait() {
  long started=Stopwatch.GetTimestamp(); var timer=Stopwatch.StartNew(); ulong postHideFrame=0;
  for(int checks=0; checks<120 && timer.ElapsedMilliseconds<2000; checks++) {
   Timing t=new Timing(); t.cbSize=(uint)Marshal.SizeOf(typeof(Timing));
   if(DwmGetCompositionTimingInfo(IntPtr.Zero,ref t)!=0) return false;
   // The per-window FrameDisplayed fields are zero with HWND=NULL here.
   // Track an actual post-hide composition, then wait for its presentation ack.
   if(postHideFrame==0 && t.qpcCompose>(ulong)started) postHideFrame=t.cFrame;
   if(postHideFrame>0 && t.cFrameConfirmed>=postHideFrame) return true;
   if(DwmFlush()!=0) return false;
  }
  return false;
 }
}
'@
if ([CompositionReady]::Wait()) { [Console]::Out.Write('composition-ready') } else { exit 2 }
`;

export function waitForWindowsComposition(signal: AbortSignal): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') return Promise.reject(new Error('Windows x64 composition verification required.'));
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')],
      { windowsHide: true, shell: false, timeout: 8_000, maxBuffer: 1024, signal }, (error, stdout) => {
        if (error || stdout !== 'composition-ready') reject(new Error('Windows composition could not be verified. Nothing was captured.'));
        else resolve();
      });
  });
}
