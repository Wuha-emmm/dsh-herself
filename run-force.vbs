' run-force.vbs - full restart of her stack, launched by Task Scheduler
' so the children are NOT in DSH's process tree (they survive DSH restarts).
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""E:\DSH-herself\boot.ps1"" -Force", 0, False
