param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('dev', 'build')]
    [string]$Action
)

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($null -ne $nodeCommand) {
    $nodeExe = $nodeCommand.Source
} else {
    $userProfilePath = [Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($userProfilePath)) {
        $userProfilePath = $env:USERPROFILE
    }
    if ([string]::IsNullOrWhiteSpace($userProfilePath)) {
        throw 'Unable to resolve the current Windows user profile.'
    }

    $bundledNode = Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $bundledNode -PathType Leaf)) {
        throw 'Node.js 24+ was not found in PATH or in the bundled Codex runtime.'
    }
    $nodeExe = $bundledNode
}

if ($Action -eq 'dev') {
    & $nodeExe (Join-Path $projectRoot 'node_modules\vite\bin\vite.js') --host 127.0.0.1 --port 5173 --strictPort
    exit $LASTEXITCODE
}

& $nodeExe (Join-Path $projectRoot 'node_modules\typescript\bin\tsc') --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $nodeExe (Join-Path $projectRoot 'node_modules\vite\bin\vite.js') build
exit $LASTEXITCODE
