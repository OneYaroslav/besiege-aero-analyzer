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

& $nodeExe (Join-Path $projectRoot 'src\cli.ts') @args
exit $LASTEXITCODE
