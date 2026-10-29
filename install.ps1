# Install / remove "herself" plugin for DSH.
# Usage:
#   powershell -ExecutionPolicy Bypass -File E:\DSH-herself\install.ps1
#   powershell -ExecutionPolicy Bypass -File E:\DSH-herself\install.ps1 -Remove
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$dsh     = 'E:\Open\DeepSeek\resources\runtime\cli\bin\dsh.cmd'
$plugin  = 'E:\DSH-herself\plugin'
$profRoot = Join-Path $env:USERPROFILE '.dsh\profiles'

if (-not (Test-Path $dsh))    { throw "DSH CLI not found: $dsh" }
if (-not (Test-Path $plugin)) { throw "Plugin dir not found: $plugin" }

$profiles = @(Get-ChildItem $profRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
if (-not $profiles) { throw "No DSH profile under $profRoot" }
$profile = if ($profiles -contains 'desktop') { 'desktop' } else { $profiles[0] }
Write-Host "profile = $profile"

if ($Remove) {
    & $dsh plugin --profile $profile remove dsh-herself
    Write-Host "Removed. Restart DSH. Her data stays in E:\DSH-herself\life" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

& $dsh plugin --profile $profile add "link:$plugin"
if ($LASTEXITCODE -ne 0) { Write-Host "add failed (exit=$LASTEXITCODE), trying repair..." -ForegroundColor Yellow }

# pnpm may create a cross-drive relative symlink that resolves to nothing.
# Replace it with a junction (works across volumes).
$nm   = Join-Path $profRoot "$profile\node_modules"
$link = Join-Path $nm 'dsh-herself'
if (-not (Test-Path (Join-Path $link 'package.json'))) {
    if (Test-Path $link) {
        Rename-Item -LiteralPath $link -NewName "dsh-herself.broken-$(Get-Random)"
    }
    cmd /c mklink /J "$link" "$plugin" | Out-Null
}
if (-not (Test-Path (Join-Path $link 'package.json'))) { throw "junction still broken: $link" }
Write-Host "junction ok"

# Make sure the bundle is declared in the profile manifest.
$pkgFile = Join-Path $profRoot "$profile\package.json"
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node -e "const fs=require('fs');const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));j.dsh=j.dsh||{};j.dsh.profile=j.dsh.profile||{};const b=j.dsh.profile.bundles||[];if(!b.includes('dsh-herself'))b.push('dsh-herself');j.dsh.profile.bundles=b;fs.writeFileSync(p,JSON.stringify(j,null,2));console.log('bundles ok')" $pkgFile

& $dsh plugin --profile $profile install
if ($LASTEXITCODE -ne 0) { throw "plugin install failed (exit=$LASTEXITCODE)" }

Write-Host ""
Write-Host "Installed. Fully quit DSH and reopen -> Settings -> 她" -ForegroundColor Green
Write-Host "Rollback: install.ps1 -Remove, then restart DSH." -ForegroundColor DarkGray
