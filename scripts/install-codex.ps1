[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$CodexHome,
    [string]$BackupRoot,
    [switch]$IncludeAuthorizedFixer
)

$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$sourceSkill = Join-Path $packageRoot 'codex\skills\information-accessibility-practice'
$sourceAgentsRoot = Join-Path $packageRoot 'codex\agents'
$manifestPath = Join-Path $packageRoot 'shared\agents\agent-manifest.json'
$verifyScript = Join-Path $PSScriptRoot 'verify-package.mjs'
$fixerId = 'information-accessibility-authorized-fixer'

function Assert-WithinRoot {
    param([string]$Path, [string]$Root, [string]$Label)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char]92, [char]47)
    $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside ${fullRoot}: $fullPath"
    }
}

function Assert-NoPathOverlap {
    param([string]$First, [string]$Second, [string]$Label)
    $firstFull = [IO.Path]::GetFullPath($First).TrimEnd([char]92, [char]47)
    $secondFull = [IO.Path]::GetFullPath($Second).TrimEnd([char]92, [char]47)
    $separator = [IO.Path]::DirectorySeparatorChar
    $same = $firstFull.Equals($secondFull, [StringComparison]::OrdinalIgnoreCase)
    $firstInsideSecond = $firstFull.StartsWith($secondFull + $separator, [StringComparison]::OrdinalIgnoreCase)
    $secondInsideFirst = $secondFull.StartsWith($firstFull + $separator, [StringComparison]::OrdinalIgnoreCase)
    if ($same -or $firstInsideSecond -or $secondInsideFirst) {
        throw "$Label must not overlap the installation destination: $firstFull <-> $secondFull"
    }
}

function Assert-SafeExistingComponents {
    param([string]$Path, [string]$Label)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $existing = [Collections.Generic.List[string]]::new()
    $cursor = $fullPath
    while ($true) {
        if (Test-Path -LiteralPath $cursor) {
            $existing.Add($cursor)
        }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    foreach ($component in $existing) {
        $item = Get-Item -LiteralPath $component -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Label contains an unsafe symbolic link, junction, or reparse point: $component"
        }
        $resolved = (Resolve-Path -LiteralPath $component -ErrorAction Stop).Path
        if (-not [IO.Path]::GetFullPath($resolved).Equals([IO.Path]::GetFullPath($component), [StringComparison]::OrdinalIgnoreCase)) {
            throw "$Label resolved outside its verified component identity: $component -> $resolved"
        }
    }
}

function Assert-SafeFile {
    param([string]$Path, [string]$Label)
    Assert-SafeExistingComponents -Path $Path -Label $Label
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing or is not a file: $Path" }
}

function Get-SafeChildPath {
    param([string]$Parent, [string]$BaseName, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($BaseName) -or $BaseName -ne [IO.Path]::GetFileName($BaseName)) {
        throw "$Label must be a safe basename: $BaseName"
    }
    Assert-SafeExistingComponents -Path $Parent -Label "$Label parent"
    $child = [IO.Path]::GetFullPath((Join-Path $Parent $BaseName))
    Assert-WithinRoot -Path $child -Root $Parent -Label $Label
    return $child
}

function Get-RelativeFiles {
    param([string]$BasePath)
    if (-not (Test-Path -LiteralPath $BasePath -PathType Container)) { return @() }
    Assert-SafeExistingComponents -Path $BasePath -Label 'Directory mirror'
    $files = @(Get-ChildItem -LiteralPath $BasePath -Recurse -Force | ForEach-Object {
        if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Directory mirror contains an unsafe symbolic link, junction, or reparse point: $($_.FullName)"
        }
        if (-not $_.PSIsContainer) { $_.FullName.Substring($BasePath.Length + 1) }
    })
    return @($files | Sort-Object)
}

function Assert-DirectoryMirror {
    param([string]$Expected, [string]$Actual)
    $expectedFiles = @(Get-RelativeFiles -BasePath $Expected)
    $actualFiles = @(Get-RelativeFiles -BasePath $Actual)
    if (Compare-Object $expectedFiles $actualFiles) { throw "File-set mismatch between $Expected and $Actual" }
    foreach ($relativePath in $expectedFiles) {
        $expectedHash = (Get-FileHash -LiteralPath (Join-Path $Expected $relativePath) -Algorithm SHA256).Hash
        $actualHash = (Get-FileHash -LiteralPath (Join-Path $Actual $relativePath) -Algorithm SHA256).Hash
        if ($expectedHash -ne $actualHash) { throw "Hash mismatch for $relativePath" }
    }
    return $expectedFiles.Count
}

function Assert-AgentFileHash {
    param([psobject]$Agent, [string]$Source, [string]$Destination, [string]$Phase)
    $sourceHash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $destinationHash) { throw "$Phase agent hash mismatch for $($Agent.id)" }
}

function Remove-SafeManagedItem {
    param([string]$Path, [switch]$Directory, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Assert-SafeExistingComponents -Path $Path -Label $Label
    if ($Directory) { Remove-Item -LiteralPath $Path -Recurse -Force } else { Remove-Item -LiteralPath $Path -Force }
}

foreach ($required in @($sourceSkill, $sourceAgentsRoot, $manifestPath, $verifyScript)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required package file is missing: $required" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required to validate the package.' }
Assert-SafeExistingComponents -Path $packageRoot -Label 'Package root'
Assert-SafeExistingComponents -Path $sourceSkill -Label 'Package skill source'
Assert-SafeExistingComponents -Path $sourceAgentsRoot -Label 'Package agent source directory'
Assert-SafeFile -Path $manifestPath -Label 'Agent manifest'

$verificationOutput = & node $verifyScript 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Package verification failed before installation: $($verificationOutput -join [Environment]::NewLine)"
}

try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw "Agent manifest is not valid UTF-8 JSON: $($_.Exception.Message)"
}
if ($null -eq $manifest.agents -or @($manifest.agents).Count -eq 0) { throw 'Agent manifest must declare at least one agent.' }

$selectedAgents = @($manifest.agents | Where-Object { $_.install_by_default -eq $true })
if ($IncludeAuthorizedFixer) {
    $fixer = @($manifest.agents | Where-Object { $_.id -eq $fixerId })
    if ($fixer.Count -ne 1) { throw "-IncludeAuthorizedFixer requires exactly one manifest entry for $fixerId; this package does not include it yet." }
    if ($fixer[0].install_by_default -eq $true) { throw "Authorized fixer $fixerId must remain opt-in in the manifest." }
    $selectedAgents += $fixer[0]
}
if ($selectedAgents.Count -eq 0) { throw 'No default agents were selected from the manifest.' }

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { $CodexHome = $env:CODEX_HOME }
    else { $CodexHome = Join-Path $env:USERPROFILE '.codex' }
}
$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$destinationSkill = Get-SafeChildPath -Parent (Join-Path $CodexHome 'skills') -BaseName 'information-accessibility-practice' -Label 'Skill destination'
$destinationAgentsRoot = [IO.Path]::GetFullPath((Join-Path $CodexHome 'agents'))
Assert-WithinRoot -Path $destinationAgentsRoot -Root $CodexHome -Label 'Agent destination directory'
Assert-SafeExistingComponents -Path $CodexHome -Label 'Codex home'

$agentIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$sourcePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$destinationPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$installAgents = foreach ($agent in $selectedAgents) {
    $id = [string]$agent.id
    if ($id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "Manifest agent id is not a safe basename: $id" }
    if (-not $agentIds.Add($id)) { throw "Duplicate selected manifest agent id: $id" }
    $source = Get-SafeChildPath -Parent $sourceAgentsRoot -BaseName "$id.toml" -Label "Package agent source for $id"
    Assert-WithinRoot -Path $source -Root $sourceAgentsRoot -Label "Package agent source for $id"
    Assert-SafeFile -Path $source -Label "Package agent source for $id"
    $destination = Get-SafeChildPath -Parent $destinationAgentsRoot -BaseName "$id.toml" -Label "Agent destination for $id"
    if (-not $sourcePaths.Add($source)) { throw "Duplicate selected agent source path: $source" }
    if (-not $destinationPaths.Add($destination)) { throw "Duplicate selected agent destination path: $destination" }
    [pscustomobject]@{ Agent = $agent; Id = $id; Source = $source; Destination = $destination }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) { $BackupRoot = Join-Path $CodexHome "backups\information-accessibility-practice\$timestamp" }
$BackupRoot = [IO.Path]::GetFullPath($BackupRoot)
Assert-NoPathOverlap -First $BackupRoot -Second $destinationSkill -Label 'Backup root'
foreach ($entry in $installAgents) { Assert-NoPathOverlap -First $BackupRoot -Second $entry.Destination -Label 'Backup root' }
Assert-SafeExistingComponents -Path $BackupRoot -Label 'Backup root'
if (Test-Path -LiteralPath $BackupRoot) { throw "Backup root already exists; choose a new empty path: $BackupRoot" }
$sourceFileCount = @(Get-RelativeFiles -BasePath $sourceSkill).Count

if ($WhatIfPreference) {
    $whatIfResult = [pscustomobject]@{
        Status = 'WHAT_IF'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        SelectedAgentIds = @($installAgents | ForEach-Object { $_.Id })
        AgentDestinations = @($installAgents | ForEach-Object { $_.Destination })
        BackupRoot = $BackupRoot
        SourceSkillFiles = $sourceFileCount
    }
    $whatIfResult | ConvertTo-Json -Depth 3
    return
}

$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("information-accessibility-install-" + [guid]::NewGuid().ToString('N'))
$stageSkill = Join-Path $stageRoot 'skill'
$stageAgentsRoot = Join-Path $stageRoot 'agents'
$backupSkill = Join-Path $BackupRoot 'skill'
$backupAgentsRoot = Join-Path $BackupRoot 'agents'
$skillExisted = Test-Path -LiteralPath $destinationSkill
$replacementStarted = $false
$agentReplacements = 0
$failAfter = 0
if (-not [string]::IsNullOrWhiteSpace($env:A11Y_TEST_FAIL_AFTER_AGENT_REPLACEMENTS)) {
    if ($env:A11Y_TEST_FAIL_AFTER_AGENT_REPLACEMENTS -notmatch '^[1-9][0-9]*$') { throw 'A11Y_TEST_FAIL_AFTER_AGENT_REPLACEMENTS must be a positive integer.' }
    $failAfter = [int]$env:A11Y_TEST_FAIL_AFTER_AGENT_REPLACEMENTS
}
foreach ($entry in $installAgents) { $entry | Add-Member -NotePropertyName Existed -NotePropertyValue (Test-Path -LiteralPath $entry.Destination) }

try {
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Copy-Item -LiteralPath $sourceSkill -Destination $stageSkill -Recurse -Force
    New-Item -ItemType Directory -Path $stageAgentsRoot -Force | Out-Null
    foreach ($entry in $installAgents) { Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $stageAgentsRoot "$($entry.Id).toml") -Force }
    $null = Assert-DirectoryMirror -Expected $sourceSkill -Actual $stageSkill
    foreach ($entry in $installAgents) { Assert-AgentFileHash -Agent $entry.Agent -Source $entry.Source -Destination (Join-Path $stageAgentsRoot "$($entry.Id).toml") -Phase 'Staged' }

    if (-not $PSCmdlet.ShouldProcess($CodexHome, "Install information accessibility skill and $($installAgents.Count) manifest-selected agents")) { return }

    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    if ($skillExisted) {
        Assert-SafeExistingComponents -Path $destinationSkill -Label 'Existing skill destination'
        Copy-Item -LiteralPath $destinationSkill -Destination $backupSkill -Recurse -Force
    }
    foreach ($entry in $installAgents) {
        if ($entry.Existed) {
            Assert-SafeExistingComponents -Path $entry.Destination -Label "Existing agent destination for $($entry.Id)"
            New-Item -ItemType Directory -Path $backupAgentsRoot -Force | Out-Null
            Copy-Item -LiteralPath $entry.Destination -Destination (Join-Path $backupAgentsRoot "$($entry.Id).toml") -Force
        }
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationSkill) -Force | Out-Null
    New-Item -ItemType Directory -Path $destinationAgentsRoot -Force | Out-Null
    Assert-SafeExistingComponents -Path $CodexHome -Label 'Codex home before replacement'
    $replacementStarted = $true
    Remove-SafeManagedItem -Path $destinationSkill -Directory -Label 'Skill replacement destination'
    Copy-Item -LiteralPath $stageSkill -Destination $destinationSkill -Recurse -Force
    foreach ($entry in $installAgents) {
        Remove-SafeManagedItem -Path $entry.Destination -Label "Agent replacement destination for $($entry.Id)"
        Copy-Item -LiteralPath (Join-Path $stageAgentsRoot "$($entry.Id).toml") -Destination $entry.Destination -Force
        $agentReplacements++
        if ($failAfter -gt 0 -and $agentReplacements -ge $failAfter) { throw "Injected A11Y_TEST_ failure after $agentReplacements agent replacements." }
    }

    $installedFileCount = Assert-DirectoryMirror -Expected $sourceSkill -Actual $destinationSkill
    foreach ($entry in $installAgents) { Assert-AgentFileHash -Agent $entry.Agent -Source $entry.Source -Destination $entry.Destination -Phase 'Installed' }
    [pscustomobject]@{
        Status = 'PASS'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        SelectedAgentIds = @($installAgents | ForEach-Object { $_.Id }) -join ', '
        AgentDestinations = @($installAgents | ForEach-Object { $_.Destination }) -join [Environment]::NewLine
        BackupRoot = $BackupRoot
        InstalledSkillFiles = $installedFileCount
        PreviousSkillBackedUp = $skillExisted
        PreviousAgentsBackedUp = @($installAgents | Where-Object { $_.Existed }).Count
    } | Format-List
} catch {
    $installError = $_
    if ($replacementStarted) {
        try {
            Remove-SafeManagedItem -Path $destinationSkill -Directory -Label 'Skill rollback destination'
            if ($skillExisted -and (Test-Path -LiteralPath $backupSkill)) { Copy-Item -LiteralPath $backupSkill -Destination $destinationSkill -Recurse -Force }
            foreach ($entry in $installAgents) {
                Remove-SafeManagedItem -Path $entry.Destination -Label "Agent rollback destination for $($entry.Id)"
                $backup = Join-Path $backupAgentsRoot "$($entry.Id).toml"
                if ($entry.Existed -and (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $backup -Destination $entry.Destination -Force }
            }
        } catch {
            throw "Installation failed: $($installError.Exception.Message). Rollback also failed: $($_.Exception.Message)"
        }
    }
    throw $installError
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Assert-SafeExistingComponents -Path $stageRoot -Label 'Installer staging directory'
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
