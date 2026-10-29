# Set a fresh DeepSeek API key without putting it in chat.
# Usage: powershell -ExecutionPolicy Bypass -File E:\DSH-herself\set-key.ps1
$ErrorActionPreference = 'Stop'
$file = 'E:\DSH-herself\secrets\deepseek.key'

Write-Host "Paste your DeepSeek API key (starts with sk-), then press Enter."
Write-Host "It will NOT be sent to the chat; it goes straight into $file" -ForegroundColor DarkGray
$key = Read-Host "key"
$key = ($key -replace '\s', '').Trim()
if (-not $key -or $key.Length -lt 20) { throw "key looks empty or too short" }

New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
Set-Content -Path $file -Value $key -NoNewline -Encoding ascii
icacls $file /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
Write-Host "saved. length=$($key.Length)  suffix=...$($key.Substring($key.Length-4))"

Write-Host "verifying..."
try {
  $r = Invoke-RestMethod 'https://api.deepseek.com/models' -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 20
  Write-Host "OK: key works. models:" -ForegroundColor Green
  $r.data | ForEach-Object { Write-Host "  - $($_.id)" }
} catch {
  Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "The key was saved but does not work. Delete it or run this script again." -ForegroundColor Yellow
  exit 1
}
