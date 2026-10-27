; electron-builder 26.18.0 shows a per-user / per-machine page when oneClick
; is false and perMachine is not true. No standard flag hides that page
; while keeping a current-user install. This supported include skips it.
;
; The shared header includes this file, and the install section includes it
; again. The guard keeps the macros defined once.
;
; customUnInstall removes only the per-user Run value named
; com.desktopcompanion.shell, and only when that value launches this
; install's DesktopCompanion.exe. An upgrade passes --updated, and the
; existing registration is left in place. userData is not referenced.
!ifndef DESKTOP_COMPANION_NSIS_HOOKS
!define DESKTOP_COMPANION_NSIS_HOOKS

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  ${If} ${isUpdated}
  ${Else}
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    StrCpy $R4 "0"
    ClearErrors
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.desktopcompanion.shell"
    ${IfNot} ${Errors}
    ${AndIf} $R0 != ""
      StrCpy $R1 '"$INSTDIR\DesktopCompanion.exe"'
      StrLen $R2 $R1
      StrCpy $R3 $R0 $R2
      ${If} $R3 == $R1
        StrCpy $R3 $R0 1 $R2
        ${If} $R3 == ""
        ${OrIf} $R3 == " "
          StrCpy $R4 "1"
        ${EndIf}
      ${Else}
        StrCpy $R1 "$INSTDIR\DesktopCompanion.exe"
        ${If} $R0 == $R1
          StrCpy $R4 "1"
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $R4 == "1"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.desktopcompanion.shell"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.desktopcompanion.shell"
    ${EndIf}
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  ${EndIf}
!macroend

!endif
