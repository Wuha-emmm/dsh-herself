# stop-her.ps1 - 停掉她的 node 进程和 OneBot 运行时（SnowLuma 默认；NapCat 仅回滚时存在）。
# 不碰用户自己的 QQ：只关从 DSH-herself\SnowLuma 或 NapCat 目录起来的那些进程。
$ErrorActionPreference = 'SilentlyContinue'
$root = 'E:\DSH-herself'
$pidFile = Join-Path $root 'logs\pids.json'

if (Test-Path $pidFile) {
    try {
        $p = Get-Content $pidFile -Raw | ConvertFrom-Json
        foreach ($id in @($p.qq, $p.wake)) {
            if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
                Stop-Process -Id $id -Force
                Write-Output "stopped node $id"
            }
        }
    } catch { }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'NapCatWinBootMain.exe' -or
    ($_.Name -eq 'QQ.exe' -and $_.CommandLine -like '*NapCat.52230.Shell*')
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
    Write-Output "stopped $($_.Name) $($_.ProcessId)"
}

Write-Output 'she is stopped'
New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null
Set-Content -Path (Join-Path $root 'logs\paused.flag') -Value ((Get-Date).ToString('o')) -Encoding ascii
Write-Output 'paused: the 5-minute watchdog will not restart her until you press start'

# ---- SnowLuma 运行时：停止时一并关掉（只关 DSH-herself 目录下的，不碰用户自己的 QQ）----
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -like '*DSH-herself\SnowLuma*' -or $_.CommandLine -like '*DSH-herself/SnowLuma*'
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "stopped SnowLuma pid=$($_.ProcessId)"
}
