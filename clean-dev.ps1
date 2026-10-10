[CmdletBinding()]
param(
    [switch]$AllBuildArtifacts,
    [switch]$WebDist,
    [switch]$PackageStore,
    [switch]$ToolCache
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$projectPrefix = $projectRoot + '\'
$removedBytes = [int64]0

function Assert-ProjectPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $resolved"
    }
    if ($resolved.Equals($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove the project root."
    }
    return $resolved
}

function Get-PathBytes {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return [int64](Get-Item -LiteralPath $Path).Length
    }
    if (Test-Path -LiteralPath $Path -PathType Container) {
        return [int64]((Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum)
    }
    return [int64]0
}

function Remove-RegeneratablePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $safePath = Assert-ProjectPath -Path $Path
    if (-not (Test-Path -LiteralPath $safePath)) {
        return
    }
    $script:removedBytes += Get-PathBytes -Path $safePath
    Write-Host "Removing regeneratable artifact: $safePath"
    Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Remove-ReleaseCompilerFiles {
    param([Parameter(Mandatory = $true)][string]$ReleaseDirectory)

    $safeRelease = Assert-ProjectPath -Path $ReleaseDirectory
    if (-not (Test-Path -LiteralPath $safeRelease -PathType Container)) {
        return
    }

    foreach ($directoryName in @('.fingerprint', 'build', 'deps', 'examples', 'incremental')) {
        Remove-RegeneratablePath -Path (Join-Path $safeRelease $directoryName)
    }

    # Preserve the distributable executable and bundle/ directory.  These exact
    # root-level compiler by-products are safe to regenerate with `tauri build`.
    $compilerExtensions = @('.d', '.dll', '.exp', '.lib', '.pdb', '.rlib', '.rmeta')
    foreach ($file in Get-ChildItem -LiteralPath $safeRelease -File -Force) {
        if ($compilerExtensions -contains $file.Extension.ToLowerInvariant()) {
            Remove-RegeneratablePath -Path $file.FullName
        }
    }
}

$tauriTarget = Join-Path $projectRoot 'src-tauri\target'
if ($AllBuildArtifacts) {
    Remove-RegeneratablePath -Path $tauriTarget
} else {
    Remove-RegeneratablePath -Path (Join-Path $tauriTarget 'debug')
    Remove-ReleaseCompilerFiles -ReleaseDirectory (Join-Path $tauriTarget 'release')
}

foreach ($logName in @('.devserver.out.log', '.devserver.err.log')) {
    Remove-RegeneratablePath -Path (Join-Path $projectRoot $logName)
}

if ($WebDist) {
    Remove-RegeneratablePath -Path (Join-Path $projectRoot 'dist')
}

if ($PackageStore) {
    Remove-RegeneratablePath -Path (Join-Path $projectRoot '.pnpm-store')
}

if ($ToolCache) {
    Write-Warning 'Removing .tools disables the cached reverse-engineering/extraction toolchain until it is restored.'
    Remove-RegeneratablePath -Path (Join-Path $projectRoot '.tools')
}

$removedMiB = [math]::Round($removedBytes / 1MB, 2)
Write-Host "Cleanup complete. Removed approximately $removedMiB MiB."
Write-Host 'Preserved node_modules, source/data, the current dist unless -WebDist was used, distributable release files, and the user mesh cache.'
