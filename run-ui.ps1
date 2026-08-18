[CmdletBinding()]
param(
    [int]$Port = 5173,
    [switch]$NoOpen
)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
} else {
    $bundledNode = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $bundledNode -PathType Leaf)) {
        throw 'Node.js 24+ was not found in PATH or in the bundled Codex runtime.'
    }
    $nodeExe = $bundledNode
}

$viteScript = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteScript -PathType Leaf)) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -ne $npmCommand) {
        & $npmCommand.Source install --prefix $projectRoot
    } else {
        $bundledPnpm = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs'
        if (-not (Test-Path -LiteralPath $bundledPnpm -PathType Leaf)) {
            throw 'Frontend dependencies are missing. Install them with npm install before running the UI.'
        }
        & $nodeExe $bundledPnpm install --dir $projectRoot
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$viteArgs = @($viteScript, '--host', '127.0.0.1', '--port', [string]$Port, '--strictPort')
if (-not $NoOpen) { $viteArgs += '--open' }

Push-Location $projectRoot
try {
    & $nodeExe @viteArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
