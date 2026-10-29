#requires -Version 5.1
<#
  把本仓库推上 GitHub（需要你的 GitHub 凭据）。

  为什么要这个脚本：创建仓库和推送都必须用**你自己的** GitHub 账号，
  任何别人（包括 AI）都替不了。这个脚本把剩下的步骤压成一条命令。

  用法：
    powershell -ExecutionPolicy Bypass -File tools\push-github.ps1 -User 你的GitHub用户名

  它会：
    1. 设置 origin 为 https://github.com/<user>/dsh-herself.git
    2. git push -u origin main（第一次会弹浏览器让你登录 GitHub，点一下就行）
    3. 打印仓库地址

  注意：仓库要**先建好**（空仓库，不要勾 README/gitignore），否则推不上去。
  建仓库地址：https://github.com/new
#>
param(
  [Parameter(Mandatory = $true)][string]$User,
  [string]$Repo = 'dsh-herself',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$url = "https://github.com/$User/$Repo.git"
$existing = git remote get-url origin 2>$null
if ($existing -and -not $Force) {
  Write-Host "origin 已经指向 $existing（要改加 -Force）" -ForegroundColor Yellow
  exit 1
}
git remote remove origin 2>$null | Out-Null
git remote add origin $url
Write-Host "origin → $url"

Write-Host "`n开始推送（第一次会弹浏览器登录 GitHub）…" -ForegroundColor Cyan
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n推送失败。常见原因：" -ForegroundColor Red
  Write-Host "  1) 仓库还没建：先去 https://github.com/new 建一个空仓库（不要勾 README）"
  Write-Host "  2) 登录被取消：重跑一次，点浏览器里的授权"
  Write-Host "  3) 名字不对：-User 后面是用户名，不是昵称"
  exit $LASTEXITCODE
}

Write-Host "`n推上去了：https://github.com/$User/$Repo" -ForegroundColor Green
Write-Host "记得去 Settings → 把仓库设成 Private（如果你想保持私有）"