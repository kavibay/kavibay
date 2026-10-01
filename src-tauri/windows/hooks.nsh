; Tauri NSIS installer hooks (bundle.windows.nsis.installerHooks).

; Ask why, once the app is gone. Not on an update, which runs this same
; uninstaller with /UPDATE, and not on a silent uninstall, which nobody watches.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    ExecShell "open" "https://kavibay.com/feedback?source=uninstall&v=${VERSION}"
  ${EndIf}
!macroend
