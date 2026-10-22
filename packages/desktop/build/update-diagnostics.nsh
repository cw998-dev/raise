# Dedicated update trace, separate from install directory/ephemeral PLUGINSDIR.
# Hooks below preserve electron-builder 26.15.3 handleUninstallResult semantics.
# No process-check bypass, forced overwrite, registry deletion or customRemoveFiles.
Var /GLOBAL raiseTraceFile
Var /GLOBAL raiseTracePath
Var /GLOBAL raiseTraceRoot
Var /GLOBAL raiseTracePid
Var /GLOBAL raiseTraceTick
Var /GLOBAL raiseTraceLength
Var /GLOBAL raiseTraceErrors
Var /GLOBAL raiseTraceExtra
Var /GLOBAL raiseTraceUpdated
Var /GLOBAL raiseTraceForceRun
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL raiseUninstallExit
  Var /GLOBAL raiseUninstallLaunchFailed
  Var /GLOBAL raiseOldDirectory
  Var /GLOBAL raiseOldUninstall
!endif

!macro RaiseUpdateTrace STAGE
  # Capture before any file command can change the NSIS error flag.
  IfErrors raise_trace_error_${STAGE} raise_trace_ok_${STAGE}
  raise_trace_error_${STAGE}:
    StrCpy $raiseTraceErrors 1
    Goto raise_trace_start_${STAGE}
  raise_trace_ok_${STAGE}:
    StrCpy $raiseTraceErrors 0
  raise_trace_start_${STAGE}:
    # Generated flag helpers use R9. Do not leak their scratch register to caller.
    Push $R9
    StrCpy $raiseTraceUpdated "unknown"
    StrCpy $raiseTraceForceRun "unknown"
    !ifdef isUpdated
      StrCpy $raiseTraceUpdated 0
      ${if} ${isUpdated}
        StrCpy $raiseTraceUpdated 1
      ${endIf}
    !endif
    !ifdef isForceRun
      StrCpy $raiseTraceForceRun 0
      ${if} ${isForceRun}
        StrCpy $raiseTraceForceRun 1
      ${endIf}
    !endif
    Pop $R9
    ReadEnvStr $raiseTraceRoot "LOCALAPPDATA"
    StrCmp $raiseTraceRoot "" raise_trace_done_${STAGE}
    StrCpy $raiseTracePath "$raiseTraceRoot\Raise\update-diagnostics\nsis.log"
    CreateDirectory "$raiseTraceRoot\Raise\update-diagnostics"
    ClearErrors
    FileOpen $raiseTraceFile "$raiseTracePath" a
    IfErrors raise_trace_done_${STAGE}
    FileSeek $raiseTraceFile 0 END $raiseTraceLength
    StrCmp $raiseTraceLength 0 0 +2
      FileWriteUTF16LE /BOM $raiseTraceFile ""
    System::Call 'kernel32::GetCurrentProcessId() i .s'
    Pop $raiseTracePid
    System::Call 'kernel32::GetTickCount() i .s'
    Pop $raiseTraceTick
    FileWriteUTF16LE $raiseTraceFile "stage=${STAGE}|pid=$raiseTracePid|tick=$raiseTraceTick|built-version=${VERSION}|mode=$installMode|updated=$raiseTraceUpdated|force-run=$raiseTraceForceRun|install-dir=$INSTDIR|$raiseTraceExtra$\r$\n"
    FileClose $raiseTraceFile
  raise_trace_done_${STAGE}:
    StrCmp $raiseTraceErrors 1 0 raise_trace_clear_${STAGE}
      SetErrors
      Goto raise_trace_end_${STAGE}
    raise_trace_clear_${STAGE}:
      ClearErrors
    raise_trace_end_${STAGE}:
!macroend

!macro customInit
  # Assisted installer users can still change directory/mode after this initial observation.
  StrCpy $raiseTraceExtra "initial-directory-and-mode=not-final"
  !insertmacro RaiseUpdateTrace installer-init
!macroend

!macro customUnInit
  StrCpy $raiseTraceExtra "old-file-failures-not-observable-in-this-hook"
  !insertmacro RaiseUpdateTrace uninstaller-init
!macroend

!macro customInstall
  StrCpy $raiseTraceExtra "new-files-installed"
  !insertmacro RaiseUpdateTrace installer-files-installed
!macroend

!macro RaiseHandleUninstallResult ROOT
  # A hook REPLACES the stock handler (stock immediately returns after the macro).
  # Save flag and exit code before logging, then retain its launch-error/nonzero/success branches.
  IfErrors raise_uninstall_launch_error_${ROOT} raise_uninstall_launched_${ROOT}
  raise_uninstall_launch_error_${ROOT}:
    StrCpy $raiseUninstallLaunchFailed 1
    Goto raise_uninstall_capture_${ROOT}
  raise_uninstall_launched_${ROOT}:
    StrCpy $raiseUninstallLaunchFailed 0
  raise_uninstall_capture_${ROOT}:
    StrCpy $raiseUninstallExit $R0
    # installUtil declares its own old-path vars AFTER this hook's expansion point.
    # Query registry into our own already-declared vars; an absent entry is not an install failure.
    ReadRegStr $raiseOldDirectory ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ReadRegStr $raiseOldUninstall ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    StrCpy $raiseTraceExtra "registry-pass=${ROOT}|launch-failed=$raiseUninstallLaunchFailed|exit-code=$raiseUninstallExit|registered-old-directory=$raiseOldDirectory|registered-uninstall-command=$raiseOldUninstall|staged-old-uninstaller=$PLUGINSDIR\old-uninstaller.exe"
    !insertmacro RaiseUpdateTrace uninstall-result-${ROOT}
    StrCpy $R0 $raiseUninstallExit
    # Restore original flag, then execute the exact stock IfErrors/Return semantics.
    StrCmp $raiseUninstallLaunchFailed 1 0 raise_uninstall_clear_${ROOT}
      SetErrors
      Goto raise_uninstall_decide_${ROOT}
    raise_uninstall_clear_${ROOT}:
      ClearErrors
    raise_uninstall_decide_${ROOT}:
      IfErrors 0 +3
        DetailPrint "Uninstall was not successful. Not able to launch uninstaller!"
        Return
      ${if} $R0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $raiseUninstallExit$\r$\nDiagnostic log (if writable): $raiseTracePath"
        DetailPrint "Uninstall was not successful. Uninstaller error code: $raiseUninstallExit."
        SetErrorLevel 2
        Quit
      ${endIf}
!macroend

!macro customUnInstallCheck
  !insertmacro RaiseHandleUninstallResult SHELL_CONTEXT
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro RaiseHandleUninstallResult HKEY_CURRENT_USER
!macroend
