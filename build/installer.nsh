; electron-builder 26.18.0 shows a per-user / per-machine page when oneClick
; is false and perMachine is not true. No standard flag hides that page
; while keeping a current-user install. This supported include skips it.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
