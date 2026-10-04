; Nùkún installer: a "Shortcuts" page after the folder choice.
; Windows does not let installers pin apps to the taskbar: the page says how to do it.

; Everything is declared where the page is added: the installer interface (MUI) and
; its plugins are loaded by then, which is not the case at the top of this file.
!macro customPageAfterChangeDir
  !include nsDialogs.nsh
  Var DesktopBox
  Var WantDesktop

  Function ShortcutsPage
    ; (Updates run silently: this page is not shown, and the icon already there stays.)
    !insertmacro MUI_HEADER_TEXT "Raccourcis" "Où veux-tu retrouver Nùkún ?"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 12u "Créer une icône sur le Bureau"
    Pop $DesktopBox
    ${NSD_Check} $DesktopBox
    ${NSD_CreateLabel} 0 22u 100% 12u "Nùkún sera aussi dans le menu Démarrer."
    Pop $0
    ${NSD_CreateLabel} 0 44u 100% 40u "Barre des tâches : Windows ne permet pas à un installateur d'y ajouter une application. Pour l'y épingler : ouvre le menu Démarrer, fais un clic droit sur Nùkún, puis « Épingler à la barre des tâches »."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function ShortcutsLeave
    ${NSD_GetState} $DesktopBox $WantDesktop
  FunctionEnd

  Page custom ShortcutsPage ShortcutsLeave
!macroend

!macro customInstall
  ${If} $WantDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ; Same identity as the app, so its windows group under this icon.
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInstall
  ; An update uninstalls the previous version first: the icon must stay.
  ${ifNot} ${isUpdated}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${endIf}
!macroend
