# stop-her.ps1 - 停掉她的 node 进程和 OneBot 运行时（SnowLuma 默认；NapCat 仅回滚时存在）。
# 不碰用户自己的 QQ：只关从 DSH-herself\SnowLuma 或 NapCat 目录起来的那些进程。
# 破坏性操作要二次确认：面板会显式传 -Yes（用户点过确认），
# 手动敲命令时不带 -Yes 就先问一句；非交互环境直接拒绝，避免手滑/脚本误伤。
param([switch]$Yes)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Yes) {
    if (-not [Environment]::UserInteractive) {
        Write-Host '这是破坏性操作：要停她请显式加 -Yes' -ForegroundColor Yellow
        exit 2
    }
    $answer = Read-Host '要停掉她（含 QQ 运行时）吗？输入 yes 确认'
    if ($answer -ne 'yes') { Write-Host '已取消'; exit 0 }
}
$root = 'E:\DSH-herself'
$pidFile = Join-Path $root 'logs\pids.json'

if (Test-Path $pidFile) {
    try {
        $p = Get-Content $pidFile -Raw | ConvertFrom-Json
        foreach ($id in @($p.qq, $p.wake, $p.inbox)) {
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

# ---- 邮箱值班 + SnowLuma 运行时：停止时一并关掉（只关 DSH-herself 目录下的，不碰用户自己的 QQ）----
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    ($_.CommandLine -like '*inbox-worker.mjs*') -or
    ($_.CommandLine -like '*DSH-herself\SnowLuma*') -or ($_.CommandLine -like '*DSH-herself/SnowLuma*')
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "stopped pid=$($_.ProcessId)"
}
