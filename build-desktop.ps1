$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

$userProfilePath = [Environment]::GetFolderPath('UserProfile')
if ([string]::IsNullOrWhiteSpace($userProfilePath)) {
    $userProfilePath = $env:USERPROFILE
}
if ([string]::IsNullOrWhiteSpace($userProfilePath)) {
    throw 'Unable to resolve the current Windows user profile.'
}

if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
} else {
    $nodeExe = Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

$tauriScript = Join-Path $projectRoot 'node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'Node.js 24+ is required.' }
if (-not (Test-Path -LiteralPath $tauriScript -PathType Leaf)) { throw 'Frontend dependencies are missing. Run npm install first.' }

$cargoBin = Join-Path $userProfilePath '.cargo\bin'
$env:PATH = "$(Split-Path -Parent $nodeExe);$cargoBin;$env:PATH"
. (Join-Path $projectRoot 'scripts\tauri-environment.ps1')
Initialize-TauriBuildEnvironment

Push-Location $projectRoot
try {
    & $nodeExe $tauriScript build
    $desktopBuildExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($desktopBuildExitCode -eq 0) {
    $releaseExecutable = Join-Path $projectRoot 'src-tauri\target\release\besiege-aero-analyzer.exe'
    $rootExecutable = Join-Path $projectRoot 'Besiege Aero Analyzer.exe'
    if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
        throw "Tauri reported success but the release executable is missing: $releaseExecutable"
    }
    Copy-Item -LiteralPath $releaseExecutable -Destination $rootExecutable -Force
    Write-Host "Portable executable copied to: $rootExecutable"
}

exit $desktopBuildExitCode
