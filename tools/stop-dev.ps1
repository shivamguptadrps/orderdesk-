# Stops the local backend and Expo, including leftover backend workers that keep port 8000 busy
# and serve old code. Called by start-dev.cmd and stop-dev.cmd (with -ExecutionPolicy Bypass).

$ErrorActionPreference = 'SilentlyContinue'

# Anything listening on the dev ports
foreach ($port in 8000, 8081) {
    Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}

# uvicorn processes, and reload workers whose parent is gone
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
    $_.CommandLine -match 'uvicorn app\.main' -or
    ($_.CommandLine -match 'spawn_main' -and -not (Get-Process -Id $_.ParentProcessId))
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Expo dev server
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'expo' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Old windows opened by start-dev.cmd
Get-Process cmd | Where-Object { $_.MainWindowTitle -like '*OrderDesk BACKEND*' -or $_.MainWindowTitle -like '*OrderDesk MOBILE*' } |
    Stop-Process -Force

Write-Host 'Stopped backend and Expo.'
