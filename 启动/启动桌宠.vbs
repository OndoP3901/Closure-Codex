Option Explicit

Dim files, shell, folder, repository, cargoTarget, executable, newest
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = files.GetParentFolderName(WScript.ScriptFullName)
repository = files.GetParentFolderName(folder)
executable = ""

cargoTarget = shell.Environment("PROCESS")("CARGO_TARGET_DIR")
If Len(cargoTarget) > 0 Then
    shell.CurrentDirectory = files.BuildPath(repository, "tauri")
    PickRelease files.GetAbsolutePathName(cargoTarget)
End If
PickRelease files.BuildPath(repository, "tauri\target")
PickRelease files.BuildPath(repository, "tauri\local-toolchain\target")
If Len(executable) = 0 Then
    PickExecutable files.BuildPath(repository, "tauri\dist\closure-companion-tauri.exe")
End If

If WScript.Arguments.Count = 1 Then
    If WScript.Arguments(0) = "--path" Then
        If Len(executable) = 0 Then WScript.Quit 1
        WScript.Echo executable
        WScript.Quit 0
    End If
End If

If Len(executable) = 0 Then
    shell.Popup "Build the desktop pet in Release mode, or extract a Windows release bundle. See README.md.", 0, "Closure Companion", 48
    WScript.Quit 1
End If

shell.CurrentDirectory = files.GetParentFolderName(executable)
shell.Run """" & executable & """", 1, False

Sub PickRelease(target)
    PickExecutable files.BuildPath(target, "release\closure-companion-tauri.exe")
End Sub

Sub PickExecutable(candidate)
    If Not files.FileExists(candidate) Then Exit Sub
    Dim modified
    modified = files.GetFile(candidate).DateLastModified
    If Len(executable) = 0 Or modified > newest Then
        executable = candidate
        newest = modified
    End If
End Sub
