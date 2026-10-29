@echo off
chcp 65001 >nul
cd /d "E:\DSH-herself\NapCat.Shell.Windows.OneKey\NapCat.52230.Shell"
if not exist "E:\DSH-herself\logs" mkdir "E:\DSH-herself\logs"
echo ==== quick start %date% %time% ==== >> "E:\DSH-herself\logs\napcat.log"
call NapCatWinBootMain.exe %1 >> "E:\DSH-herself\logs\napcat.log" 2>&1
echo ==== quick exit %date% %time% ==== >> "E:\DSH-herself\logs\napcat.log"
