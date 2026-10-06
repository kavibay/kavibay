; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).

!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri clears the legacy AppData/WebView directories for this same choice.
  ; The durable profile (including first-run and tour state) lives in ~/.kavibay.
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$PROFILE\.kavibay"
  ${EndIf}

  ; Ask why after uninstall, but never during an update or silent uninstall.
  ${If} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    ExecShell "open" "https://kavibay.com/feedback?source=uninstall&v=${VERSION}"
  ${EndIf}
!macroend
