$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
} else {
    $nodeExe = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

$tauriScript = Join-Path $projectRoot 'node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) { throw 'Node.js 24+ is required.' }
if (-not (Test-Path -LiteralPath $tauriScript -PathType Leaf)) { throw 'Frontend dependencies are missing. Run npm install first.' }

$cargoBin = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo\bin'
$env:PATH = "$(Split-Path -Parent $nodeExe);$cargoBin;$env:PATH"
. (Join-Path $projectRoot 'scripts\tauri-environment.ps1')
Initialize-TauriBuildEnvironment

Push-Location $projectRoot
try {
    & $nodeExe $tauriScript build
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
