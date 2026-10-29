@echo off
chcp 65001 >nul
cd /d "%~dp0NapCat.Shell.Windows.OneKey\NapCat.52230.Shell"
if not exist "E:\DSH-herself\logs" mkdir "E:\DSH-herself\logs"
echo ==== start %date% %time% ==== >> "E:\DSH-herself\logs\napcat.log"
call napcat.bat >> "E:\DSH-herself\logs\napcat.log" 2>&1
echo ==== exit %date% %time% ==== >> "E:\DSH-herself\logs\napcat.log"
