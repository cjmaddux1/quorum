$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $root "server.mjs"
$port = 9977
$portInUse = Test-NetConnection -ComputerName "127.0.0.1" -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $portInUse) {
    Start-Process -FilePath "node.exe" -ArgumentList "`"$serverScript`"" -WorkingDirectory $root -WindowStyle Hidden
    Start-Sleep -Seconds 2
}
Start-Process "http://127.0.0.1:$port/"
