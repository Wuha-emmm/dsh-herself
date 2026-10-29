' run-hidden.vbs - launch boot.ps1 with no visible window at all.
' Task Scheduler + powershell -WindowStyle Hidden still flashes a console;
' WScript.Shell.Run with window style 0 does not.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""E:\DSH-herself\boot.ps1""", 0, False
