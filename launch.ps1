$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$appFolder = $PSScriptRoot
$appUrl = 'http://127.0.0.1:17414'
try {
    $ready = $false
    try {
        $health = Invoke-RestMethod "$appUrl/api/health" -TimeoutSec 2
        if ($health.app -ne 'ffxiv-companion') { throw 'Port 17414 is used by another application.' }
        $ready = $true
    } catch { if ($_.Exception.Message -like '*another application*') { throw } }
    if (-not $ready) {
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        $nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
        $candidates = @(
            "$env:ProgramFiles\nodejs\node.exe",
            "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
            "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
        )
        if (-not $nodePath) { $nodePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
        if (-not $nodePath) { throw 'Node.js 22+ is required. Install Node.js LTS from https://nodejs.org and open this app again.' }
        $major = [int]((& $nodePath --version) -replace '^v(\d+).*', '$1')
        if ($major -lt 22) { throw 'Node.js 22 or newer is required.' }
        $dataFolder = Join-Path $appFolder 'data'
        New-Item -ItemType Directory -Path $dataFolder -Force | Out-Null
        Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $appFolder 'server.mjs') + '"') -WorkingDirectory $appFolder -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataFolder 'server.log') -RedirectStandardError (Join-Path $dataFolder 'error.log')
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Milliseconds 250
            try { $health = Invoke-RestMethod "$appUrl/api/health" -TimeoutSec 1; if ($health.app -eq 'ffxiv-companion') { $ready = $true; break } } catch { }
        }
        if (-not $ready) { throw "Could not start the app. Check $dataFolder\error.log" }
    }
    $chromePaths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
    $chrome = $chromePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($chrome) { Start-Process -FilePath $chrome -ArgumentList @("--app=$appUrl", '--window-size=1200,860') }
    else { Start-Process $appUrl }
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'FFXIV Companion', 'OK', 'Error') | Out-Null
}
