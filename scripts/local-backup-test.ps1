# local-backup-test.ps1 — the "cron job" for Windows (Task Scheduler has no crontab).
#
# Runs `npm run db:backup` end-to-end (pg_dump -> sha256 -> R2 upload -> HeadObject
# verify -> retention) and appends everything, timestamped, to logs\backup-test.log.
#
# Why PATH matters: pg_dump lives in C:\Program Files\PostgreSQL\18\bin and is NOT
# on the system PATH. The scheduled task starts with a clean environment, so we
# prepend it here — otherwise pg_dump "works in your terminal" but dies in the task.
#
# Registered as task: MCS-BackupTest   (every 1 minute while testing)
#   schtasks /Create /TN MCS-BackupTest /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\codebase\mothercare-backend\scripts\local-backup-test.ps1" /SC MINUTE /MO 1 /F
#   schtasks /Delete /TN MCS-BackupTest /F      <- remove when testing is done

$ErrorActionPreference = 'Continue'
$root = 'D:\codebase\mothercare-backend'
$log  = Join-Path $root 'logs\backup-test.log'

$env:PATH = 'C:\Program Files\PostgreSQL\18\bin;' + $env:PATH
Set-Location $root

$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$out = & npm run db:backup 2>&1 | Out-String
$code = $LASTEXITCODE

$block = @(
  ''
  "===== $stamp  exit=$code  (task: MCS-BackupTest) ====="
  $out.TrimEnd()
) -join "`r`n"

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Add-Content -Path $log -Value $block
Write-Output $block
