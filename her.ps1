# Start / stop / status for her two background processes.
# Usage: powershell -ExecutionPolicy Bypass -File E:\DSH-herself\her.ps1 -Action start|stop|status
param([ValidateSet('start','stop','status')]$Action = 'status')

$ErrorActionPreference = 'Continue'
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$root = 'E:\DSH-herself'
$logs = Join-Path $root 'logs'
$pidFile = Join-Path $logs 'pids.json'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Get-Pids {
    if (Test-Path $pidFile) { try { return Get-Content $pidFile -Raw | ConvertFrom-Json } catch { return $null } }
    return $null
}
function Alive($id) {
    if (-not $id) { return $false }
    return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue)
}

switch ($Action) {
    'stop' {
        $p = Get-Pids
        foreach ($id in @($p.qq, $p.wake)) { if (Alive $id) { Stop-Process -Id $id -Force; Write-Host "stopped $id" } }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Write-Host "all stopped"
    }
    'start' {
        Remove-Item (Join-Path $logs 'paused.flag') -Force -ErrorAction SilentlyContinue
        $p = Get-Pids
        if (Alive $p.qq) { Write-Host "qq listener already running ($($p.qq))" } else {
            $p1 = Start-Process -FilePath $node -ArgumentList 'hands/qq.mjs','listen' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$logs\qq.out.log" -RedirectStandardError "$logs\qq.err.log" -PassThru
            Write-Host "qq listener started ($($p1.Id))"
        }
        Start-Sleep -Seconds 1
        if (Alive $p.wake) { Write-Host "wake loop already running ($($p.wake))" } else {
            $p2 = Start-Process -FilePath $node -ArgumentList 'wake.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$logs\wake.out.log" -RedirectStandardError "$logs\wake.err.log" -PassThru
            Write-Host "wake loop started ($($p2.Id))"
        }
        $cur = Get-Pids
        @{ qq = $(if (Alive $cur.qq) { $cur.qq } else { $p1.Id }); wake = $(if (Alive $cur.wake) { $cur.wake } else { $p2.Id }); startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $pidFile
    }
    'status' {
        $p = Get-Pids
        if (-not $p) { Write-Host "not started" } else {
            Write-Host "qq   pid=$($p.qq)  alive=$(Alive $p.qq)"
            Write-Host "wake pid=$($p.wake)  alive=$(Alive $p.wake)"
        }
        Write-Host "--- qq.out (tail) ---"; Get-Content "$logs\qq.out.log" -Encoding UTF8 -Tail 5 -ErrorAction SilentlyContinue
        Write-Host "--- wake.out (tail) ---"; Get-Content "$logs\wake.out.log" -Encoding UTF8 -Tail 5 -ErrorAction SilentlyContinue
    }
}
