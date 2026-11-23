Option Explicit
Dim shell, files, entry, command, code
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
entry = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "outputs\closure-decoration\Theme.ps1")
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe") & """ -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & entry & """ -Mode enable -Silent"
On Error Resume Next
code = shell.Run(command, 0, True)
If Err.Number <> 0 Then
    MsgBox "Could not start the Codex theme launcher: " & Err.Description, vbCritical, "Codex theme"
    WScript.Quit 1
End If
WScript.Quit code
