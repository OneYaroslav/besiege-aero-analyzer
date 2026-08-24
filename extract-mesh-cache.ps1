param(
    [string]$BesiegeRoot = "C:\Program Files (x86)\Steam\steamapps\common\Besiege",
    [string]$OutputDir = "",
    [switch]$ReinstallDependencies
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dependencyDir = Join-Path $projectRoot ".tools\unitypy"
$requirements = Join-Path $projectRoot "tools\mesh-extractor-requirements.txt"
$extractor = Join-Path $projectRoot "tools\extract_unity_visual_meshes.py"

if (-not (Test-Path -LiteralPath $BesiegeRoot -PathType Container)) {
    throw "Besiege installation not found: $BesiegeRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $BesiegeRoot "Besiege_Data\level0") -PathType Leaf)) {
    throw "Besiege_Data\level0 not found under: $BesiegeRoot"
}

$bundledPython = Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$python = if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
    [pscustomobject]@{ Source = $bundledPython }
} else {
    Get-Command python -ErrorAction SilentlyContinue
}
$pythonPrefix = @()
if ($null -eq $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
    $pythonPrefix = @("-3")
}
if ($null -eq $python) {
    throw "Python 3 was not found. Install Python 3, then run this launcher again."
}
Write-Host "Using Python: $($python.Source)"

$unityPyModule = Join-Path $dependencyDir "UnityPy"
$typeTreeModule = Join-Path $dependencyDir "TypeTreeGeneratorAPI"
if ($ReinstallDependencies -or -not (Test-Path -LiteralPath $unityPyModule -PathType Container) -or -not (Test-Path -LiteralPath $typeTreeModule -PathType Container)) {
    New-Item -ItemType Directory -Path $dependencyDir -Force | Out-Null
    Write-Host "Installing the geometry extractor dependencies into .tools\unitypy ..."
    & $python.Source @pythonPrefix -m pip install --disable-pip-version-check --upgrade --target $dependencyDir -r $requirements
    if ($LASTEXITCODE -ne 0) { throw "Failed to install mesh extractor dependencies." }
}

$runExtractor = "import os,runpy,sys; dependency_dir=sys.argv[1]; script=sys.argv[2]; sys.path.insert(0,dependency_dir); sys.path.insert(0,os.path.dirname(script)); import UnityPy; sys.argv=sys.argv[2:]; runpy.run_path(script,run_name='__main__')"
$arguments = @(
    "-c", $runExtractor,
    $dependencyDir,
    $extractor,
    "--besiege-root", $BesiegeRoot
)
if (-not [string]::IsNullOrWhiteSpace($OutputDir)) {
    $arguments += @("--output-dir", $OutputDir)
}
& $python.Source @pythonPrefix @arguments
if ($LASTEXITCODE -ne 0) { throw "Besiege visual mesh extraction failed." }

Write-Host "Geometry-only cache is ready. Restart the desktop application to load it."
