Option Explicit

Dim shell, fso, projectDir, batPath, command, exitCode

projectDir = "C:\Users\kaemn\OneDrive\Desktop\PROJECTS\KaemSKP"
batPath = projectDir & "\start-kaemskp.bat"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FolderExists(projectDir) Then
  MsgBox "Folder project KaemSKP tidak ditemukan: " & projectDir, vbCritical, "KaemSKP Launcher"
  WScript.Quit 1
End If

If Not fso.FileExists(batPath) Then
  MsgBox "File launcher KaemSKP tidak ditemukan: " & batPath, vbCritical, "KaemSKP Launcher"
  WScript.Quit 1
End If

shell.CurrentDirectory = projectDir
shell.Environment("PROCESS")("KAEMSKP_FROM_VBS") = "1"

command = "cmd.exe /d /c """ & batPath & """"
exitCode = shell.Run(command, 0, True)

WScript.Quit exitCode
