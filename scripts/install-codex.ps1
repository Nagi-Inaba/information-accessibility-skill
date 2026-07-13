[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$CodexHome,
    [string]$BackupRoot
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$sourceSkill = Join-Path $packageRoot 'codex\skills\information-accessibility-practice'
$sourceAgent = Join-Path $packageRoot 'codex\agents\information-accessibility-reviewer.toml'
$verifyScript = Join-Path $PSScriptRoot 'verify-package.mjs'

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
        $CodexHome = $env:CODEX_HOME
    } else {
        $CodexHome = Join-Path $env:USERPROFILE '.codex'
    }
}

$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$destinationSkill = Join-Path $CodexHome 'skills\information-accessibility-practice'
$destinationAgent = Join-Path $CodexHome 'agents\information-accessibility-reviewer.toml'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path $CodexHome "backups\information-accessibility-practice\$timestamp"
}
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)

function Assert-WithinRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside ${fullRoot}: $fullPath"
    }
}

function Assert-NoPathOverlap {
    param(
        [Parameter(Mandatory = $true)][string]$First,
        [Parameter(Mandatory = $true)][string]$Second,
        [Parameter(Mandatory = $true)][string]$Label
    )
    $firstFull = [IO.Path]::GetFullPath($First).TrimEnd('\', '/')
    $secondFull = [IO.Path]::GetFullPath($Second).TrimEnd('\', '/')
    $separator = [IO.Path]::DirectorySeparatorChar
    $same = $firstFull.Equals($secondFull, [StringComparison]::OrdinalIgnoreCase)
    $firstInsideSecond = $firstFull.StartsWith($secondFull + $separator, [StringComparison]::OrdinalIgnoreCase)
    $secondInsideFirst = $secondFull.StartsWith($firstFull + $separator, [StringComparison]::OrdinalIgnoreCase)
    if ($same -or $firstInsideSecond -or $secondInsideFirst) {
        throw "$Label must not overlap the installation destination: $firstFull <-> $secondFull"
    }
}

function Get-RelativeFiles {
    param([Parameter(Mandatory = $true)][string]$BasePath)
    if (-not (Test-Path -LiteralPath $BasePath -PathType Container)) { return @() }
    @(
        Get-ChildItem -LiteralPath $BasePath -Recurse -File |
            ForEach-Object { $_.FullName.Substring($BasePath.Length + 1) } |
            Sort-Object
    )
}

function Assert-DirectoryMirror {
    param(
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Actual
    )
    $expectedFiles = @(Get-RelativeFiles -BasePath $Expected)
    $actualFiles = @(Get-RelativeFiles -BasePath $Actual)
    if (Compare-Object $expectedFiles $actualFiles) {
        throw "File-set mismatch between $Expected and $Actual"
    }
    foreach ($relativePath in $expectedFiles) {
        $expectedHash = (Get-FileHash -LiteralPath (Join-Path $Expected $relativePath) -Algorithm SHA256).Hash
        $actualHash = (Get-FileHash -LiteralPath (Join-Path $Actual $relativePath) -Algorithm SHA256).Hash
        if ($expectedHash -ne $actualHash) {
            throw "Hash mismatch for $relativePath"
        }
    }
    $expectedFiles.Count
}

foreach ($required in @($sourceSkill, $sourceAgent, $verifyScript)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required package file is missing: $required" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required to validate the package.' }

$verificationOutput = & node $verifyScript 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Package verification failed before installation: $($verificationOutput -join [Environment]::NewLine)"
}

Assert-WithinRoot -Path $destinationSkill -Root $CodexHome -Label 'Skill destination'
Assert-WithinRoot -Path $destinationAgent -Root $CodexHome -Label 'Agent destination'
Assert-NoPathOverlap -First $BackupRoot -Second $destinationSkill -Label 'Backup root'
Assert-NoPathOverlap -First $BackupRoot -Second $destinationAgent -Label 'Backup root'
if (Test-Path -LiteralPath $BackupRoot) {
    throw "Backup root already exists; choose a new empty path: $BackupRoot"
}
$sourceFileCount = @(Get-RelativeFiles -BasePath $sourceSkill).Count

if ($WhatIfPreference) {
    [pscustomobject]@{
        Status = 'WHAT_IF'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        AgentDestination = $destinationAgent
        BackupRoot = $BackupRoot
        SourceSkillFiles = $sourceFileCount
    } | Format-List
    return
}

$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("information-accessibility-install-" + [guid]::NewGuid().ToString('N'))
$stageSkill = Join-Path $stageRoot 'skill'
$stageAgent = Join-Path $stageRoot 'information-accessibility-reviewer.toml'
$backupSkill = Join-Path $BackupRoot 'skill'
$backupAgent = Join-Path $BackupRoot 'information-accessibility-reviewer.toml'
$skillExisted = Test-Path -LiteralPath $destinationSkill
$agentExisted = Test-Path -LiteralPath $destinationAgent
$replacementStarted = $false

try {
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Copy-Item -LiteralPath $sourceSkill -Destination $stageSkill -Recurse -Force
    Copy-Item -LiteralPath $sourceAgent -Destination $stageAgent -Force
    $null = Assert-DirectoryMirror -Expected $sourceSkill -Actual $stageSkill
    if ((Get-FileHash -LiteralPath $sourceAgent -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $stageAgent -Algorithm SHA256).Hash) {
        throw 'Staged agent hash does not match the package.'
    }

    if (-not $PSCmdlet.ShouldProcess($CodexHome, 'Install information accessibility skill and reviewer agent')) { return }

    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    if ($skillExisted) { Copy-Item -LiteralPath $destinationSkill -Destination $backupSkill -Recurse -Force }
    if ($agentExisted) { Copy-Item -LiteralPath $destinationAgent -Destination $backupAgent -Force }

    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationSkill) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationAgent) -Force | Out-Null
    $replacementStarted = $true
    if (Test-Path -LiteralPath $destinationSkill) { Remove-Item -LiteralPath $destinationSkill -Recurse -Force }
    Copy-Item -LiteralPath $stageSkill -Destination $destinationSkill -Recurse -Force
    Copy-Item -LiteralPath $stageAgent -Destination $destinationAgent -Force

    $installedFileCount = Assert-DirectoryMirror -Expected $sourceSkill -Actual $destinationSkill
    if ((Get-FileHash -LiteralPath $sourceAgent -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destinationAgent -Algorithm SHA256).Hash) {
        throw 'Installed agent hash does not match the package.'
    }

    [pscustomobject]@{
        Status = 'PASS'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        AgentDestination = $destinationAgent
        BackupRoot = $BackupRoot
        InstalledSkillFiles = $installedFileCount
        PreviousSkillBackedUp = $skillExisted
        PreviousAgentBackedUp = $agentExisted
    } | Format-List
} catch {
    if ($replacementStarted) {
        if (Test-Path -LiteralPath $destinationSkill) { Remove-Item -LiteralPath $destinationSkill -Recurse -Force }
        if ($skillExisted -and (Test-Path -LiteralPath $backupSkill)) {
            Copy-Item -LiteralPath $backupSkill -Destination $destinationSkill -Recurse -Force
        }
        if (Test-Path -LiteralPath $destinationAgent) { Remove-Item -LiteralPath $destinationAgent -Force }
        if ($agentExisted -and (Test-Path -LiteralPath $backupAgent)) {
            Copy-Item -LiteralPath $backupAgent -Destination $destinationAgent -Force
        }
    }
    throw
} finally {
    if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
}
