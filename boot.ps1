# ⚠ 这个文件必须存成 UTF-8 **带 BOM**（EF BB BF）。
# 插件用 Windows PowerShell 5.1 跑它（powershell.exe -File），5.1 没有 BOM 就按 ANSI 解码，
# 下面这些中文注释会把字符串撑破 → ParserError → 整个脚本一行都不执行，而调用方只
# console.warn 一句，谁也看不见。2026-10-29 她就这么在 DSH 重启后再也没起来过。
# 改完记得补 BOM（编辑器/工具常会抹掉）：tools/audit.mjs 会检查，缺了直接报「问题」。
#
# boot.ps1 - idempotent supervisor for her whole stack.
# Safe to run every few minutes: it only starts what is missing.
# Respects logs\paused.flag: if present, does nothing unless -Force.
param([switch]$Force)

$ErrorActionPreference = 'Continue'

$root = 'E:\DSH-herself'
$logs = Join-Path $root 'logs'
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$napcatDir = Join-Path $root 'NapCat.Shell.Windows.OneKey\NapCat.52230.Shell'
$napcatExe = Join-Path $napcatDir 'NapCatWinBootMain.exe'
$qqUin = '30003'
$pidFile = Join-Path $logs 'pids.json'

New-Item -ItemType Directory -Force -Path $logs | Out-Null

$pausedFlag = Join-Path $logs 'paused.flag'

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path (Join-Path $logs 'boot.log') -Value $line -Encoding UTF8
}

function Alive($id) {
    if (-not $id) { return $false }
    return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
}

function Get-Pids {
    if (Test-Path $pidFile) { try { return Get-Content $pidFile -Raw | ConvertFrom-Json } catch { return $null } }
    return $null
}

function PortOpen($port) {
    try {
        return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    } catch { return $false }
}

# 按命令行认出「她自己的 node」，不靠 pids.json：两个 boot 撞在同一秒时，
# 后写的那次会覆盖前一次，孤儿就永远没人杀——那正是「她每条消息回两遍」的根源。
function Find-Node([string]$pattern) {
    $hit = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like $pattern } | Select-Object -First 1
    if ($hit) { return [int]$hit.ProcessId }
    return 0
}

if ((Test-Path $pausedFlag) -and (-not $Force)) {
    Log 'paused by user, skip'
    exit 0
}
if ($Force) {
    Remove-Item $pausedFlag -Force -ErrorAction SilentlyContinue
    # -Force = 真重启：先停掉两个 node，让它们加载最新代码（比如新的 brain 端点）
    $old = $null
    if (Test-Path $pidFile) { try { $old = Get-Content $pidFile -Raw | ConvertFrom-Json } catch { } }
    foreach ($id in @($old.qq, $old.wake)) {
        if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $id -Force
            Log "force restart: stopped node $id"
        }
    }
    # pids.json 记漏的那些，按命令行补杀
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*hands/qq.mjs*' -or $_.CommandLine -like '*wake.mjs*' -or $_.CommandLine -like '*inbox-worker.mjs*' } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Log "force restart: swept orphan node $($_.ProcessId)"
        }
    Start-Sleep -Seconds 1
}

# ---- 1. QQ 运行时：snowluma（默认）或 napcat（回滚：设 DSH_QQ_RUNTIME=napcat）----
$Runtime = if ($env:DSH_QQ_RUNTIME) { $env:DSH_QQ_RUNTIME } else { 'snowluma' }
$snowDir = 'E:\DSH-herself\SnowLuma'

if ($Runtime -eq 'snowluma') {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'QQ.exe' -and $_.CommandLine -like '*NapCat.52230.Shell*'
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Log "cleaned leftover NapCat QQ $($_.ProcessId)"
    }
    if (-not (PortOpen 5099)) {
        Log 'starting SnowLuma'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','launcher.bat' -WorkingDirectory $snowDir -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logs 'snowluma.out.log') `
            -RedirectStandardError (Join-Path $logs 'snowluma.err.log')
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 2
            if (PortOpen 5099) { Log 'SnowLuma ready'; break }
        }
    } else { Log 'SnowLuma already up' }
} elseif (-not (Get-Process NapCatWinBootMain -ErrorAction SilentlyContinue)) {
    if (Test-Path $napcatExe) {
        Log 'starting NapCat'
        Start-Process -FilePath $napcatExe -ArgumentList $qqUin -WorkingDirectory $napcatDir -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logs 'napcat.out.log') `
            -RedirectStandardError (Join-Path $logs 'napcat.err.log')
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 2
            if (PortOpen 3001) { Log 'napcat OneBot 3001 ready'; break }
        }
    } else {
        Log "NapCat exe not found: $napcatExe"
    }
} elseif (-not (PortOpen 3001)) {
    Log 'NapCat process alive but 3001 not listening (still loading?)'
}

# ---- 2. her two node processes ----
$p = Get-Pids
$qqAlive = Alive $p.qq
$wakeAlive = Alive $p.wake
$inboxAlive = Alive $p.inbox

# ---- 3. 代码变了就重启她（别让她一直跑旧代码）----
# 2026-10-30：boot 是幂等的，只补缺失、不因代码变化重启；改完 lib/ hands/ 全凭"记得"敲 -Force。
# 现在 boot 自己判断：她启动时的 build 戳 < 代码最新改动时间 → 停掉重起。
if ($qqAlive) {
    $need = & $node (Join-Path $root 'tools/need-restart.mjs')
    if ("$need".Trim() -eq 'restart') {
        $old = $p.qq
        if ($old) { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue }
        Log "restart qq listener: code changed (old pid=$old)"
        $qqAlive = $false
    }
}

# 记录是死的、人还活着（孤儿）：认回来，别再多起一个
if (-not $qqAlive) {
    $live = Find-Node '*hands/qq.mjs*'
    if ($live) { $p.qq = $live; $qqAlive = $true; Log "adopted qq listener pid=$live" }
}
if (-not $wakeAlive) {
    $live = Find-Node '*wake.mjs*'
    if ($live) { $p.wake = $live; $wakeAlive = $true; Log "adopted wake loop pid=$live" }
}
# 邮箱值班：她投给 DSH 的单子不能无声堆着（常驻，不靠会话；2026-10-30）
if (-not $inboxAlive) {
    $live = Find-Node '*inbox-worker.mjs*'
    if ($live) { $p | Add-Member -NotePropertyName inbox -NotePropertyValue $live -Force; $inboxAlive = $true; Log "adopted inbox worker pid=$live" }
}

if (-not $qqAlive) {
    $p1 = Start-Process -FilePath $node -ArgumentList 'hands/qq.mjs','listen' -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'qq.out.log') -RedirectStandardError (Join-Path $logs 'qq.err.log') -PassThru
    Log "started qq listener pid=$($p1.Id)"
    $qid = $p1.Id
} else { $qid = $p.qq }

if (-not $wakeAlive) {
    $p2 = Start-Process -FilePath $node -ArgumentList 'wake.mjs','--send' -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'wake.out.log') -RedirectStandardError (Join-Path $logs 'wake.err.log') -PassThru
    Log "started wake loop pid=$($p2.Id)"
    $wid = $p2.Id
} else { $wid = $p.wake }

# 邮箱值班进程（常驻；不依赖任何会话）
if (-not $inboxAlive) {
    $p3 = Start-Process -FilePath $node -ArgumentList 'hands/inbox-worker.mjs' -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'inbox-worker.out.log') -RedirectStandardError (Join-Path $logs 'inbox-worker.err.log') -PassThru
    Log "started inbox worker pid=$($p3.Id)"
    $iid = $p3.Id
} else { $iid = $p.inbox }

$json = @{ qq = $qid; wake = $wid; inbox = $iid; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json
[System.IO.File]::WriteAllText($pidFile, $json, (New-Object System.Text.UTF8Encoding($false)))
