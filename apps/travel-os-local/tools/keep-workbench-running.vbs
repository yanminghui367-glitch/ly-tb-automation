Option Explicit
Dim shell, fs, root, command
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(fs.GetParentFolderName(WScript.ScriptFullName))
command = "node.exe """ & root & "\tools\start-workbench.mjs"" --no-open --managed"
shell.Run command, 0, True
