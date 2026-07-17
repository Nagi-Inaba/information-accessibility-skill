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

if (-not ('A11yInstaller.NativePath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace A11yInstaller {
    public static class NativePath {
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_SHARE_READ = 1;
        private const uint FILE_SHARE_WRITE = 2;
        private const uint FILE_SHARE_DELETE = 4;
        private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

        [StructLayout(LayoutKind.Sequential)]
        private struct BY_HANDLE_FILE_INFORMATION {
            public uint FileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(
            SafeFileHandle file,
            out BY_HANDLE_FILE_INFORMATION information
        );

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder path,
            uint pathLength,
            uint flags
        );

        private static SafeFileHandle Open(string path) {
            SafeFileHandle handle = CreateFileW(
                path,
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                IntPtr.Zero,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                IntPtr.Zero
            );
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open path identity: " + path);
            return handle;
        }

        public static string Identity(string path) {
            using (SafeFileHandle handle = Open(path)) {
                BY_HANDLE_FILE_INFORMATION information;
                if (!GetFileInformationByHandle(handle, out information)) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not read path identity: " + path);
                }
                return information.VolumeSerialNumber.ToString("X8") + ":" + information.FileIndexHigh.ToString("X8") + information.FileIndexLow.ToString("X8");
            }
        }

        public static string FinalPath(string path) {
            using (SafeFileHandle handle = Open(path)) {
                StringBuilder buffer = new StringBuilder(32768);
                uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0 || length >= buffer.Capacity) {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not resolve final path: " + path);
                }
                string result = buffer.ToString();
                if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + result.Substring(8);
                if (result.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return result.Substring(4);
                return result;
            }
        }
    }
}
'@ | Out-Null
}

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $root }
    return $full.TrimEnd([char]92, [char]47)
}

function Test-PathOverlap {
    param([string]$First, [string]$Second)
    $firstFull = Get-FullPath $First
    $secondFull = Get-FullPath $Second
    $separator = [IO.Path]::DirectorySeparatorChar
    return $firstFull.Equals($secondFull, [StringComparison]::OrdinalIgnoreCase) -or
        $firstFull.StartsWith($secondFull + $separator, [StringComparison]::OrdinalIgnoreCase) -or
        $secondFull.StartsWith($firstFull + $separator, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-Disjoint {
    param([string]$First, [string]$Second, [string]$Label)
    if (Test-PathOverlap -First $First -Second $Second) {
        throw "$Label paths must be disjoint: $(Get-FullPath $First) <-> $(Get-FullPath $Second)"
    }
}

function Assert-WithinRoot {
    param([string]$Path, [string]$Root, [string]$Label)
    $fullPath = Get-FullPath $Path
    $fullRoot = Get-FullPath $Root
    $prefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must stay inside ${fullRoot}: $fullPath"
    }
}

function Get-ItemIfPresent {
    param([string]$Path)
    try {
        return Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        return $null
    } catch {
        if (-not [IO.File]::Exists($Path) -and -not [IO.Directory]::Exists($Path)) { return $null }
        throw
    }
}

function Get-PathState {
    param(
        [string]$Path,
        [ValidateSet('Any', 'File', 'Directory')][string]$ExpectedType = 'Any',
        [string]$Label = 'Path'
    )
    $fullPath = Get-FullPath $Path
    $item = Get-ItemIfPresent $fullPath
    if ($null -eq $item) {
        return [pscustomobject]@{ Path = $fullPath; Exists = $false; Type = 'Absent'; Identity = $null; FinalPath = $null }
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label contains an unsafe symbolic link, junction, or reparse point: $fullPath"
    }
    $type = if ($item.PSIsContainer) { 'Directory' } else { 'File' }
    if ($ExpectedType -ne 'Any' -and $type -ne $ExpectedType) {
        throw "$Label must be a safe non-reparse $($ExpectedType.ToLowerInvariant()): $fullPath"
    }
    $finalPath = Get-FullPath ([A11yInstaller.NativePath]::FinalPath($fullPath))
    if (-not $finalPath.Equals($fullPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolved outside its canonical path: $fullPath -> $finalPath"
    }
    return [pscustomobject]@{
        Path = $fullPath
        Exists = $true
        Type = $type
        Identity = [A11yInstaller.NativePath]::Identity($fullPath)
        FinalPath = $finalPath
    }
}

function Assert-PathState {
    param([psobject]$Expected, [string]$Label)
    $expectedType = if ($Expected.Exists) { $Expected.Type } else { 'Any' }
    $actual = Get-PathState -Path $Expected.Path -ExpectedType $expectedType -Label $Label
    if ($actual.Exists -ne $Expected.Exists) { throw "$Label existence changed: $($Expected.Path)" }
    if ($Expected.Exists) {
        if ($actual.Identity -ne $Expected.Identity -or
            -not $actual.FinalPath.Equals($Expected.FinalPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$Label identity changed: $($Expected.Path)"
        }
    }
    return $actual
}

function Assert-ExistingComponentsSafe {
    param([string]$Path, [string]$Label)
    $cursor = Get-FullPath $Path
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        $item = Get-ItemIfPresent $cursor
        if ($null -ne $item) { $null = Get-PathState -Path $cursor -ExpectedType 'Any' -Label $Label }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-ExistingAncestorState {
    param([string]$Path, [string]$Label)
    $cursor = Get-FullPath $Path
    while ($true) {
        $state = Get-PathState -Path $cursor -ExpectedType 'Any' -Label $Label
        if ($state.Exists) {
            if ($state.Type -ne 'Directory') { throw "$Label existing ancestor must be a directory: $cursor" }
            return $state
        }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { throw "$Label has no safe existing ancestor: $Path" }
        $cursor = $parent
    }
}

function Ensure-VerifiedDirectory {
    param(
        [string]$Path,
        [psobject]$AncestorState,
        [string]$Label,
        [Collections.IList]$CreatedDirectories
    )
    $target = Get-FullPath $Path
    $null = Assert-PathState -Expected $AncestorState -Label "$Label ancestor"
    $existing = Get-PathState -Path $target -ExpectedType 'Any' -Label $Label
    if ($existing.Exists) {
        if ($existing.Type -ne 'Directory') { throw "$Label must be a directory: $target" }
        return $existing
    }
    $missing = [Collections.Generic.List[string]]::new()
    $cursor = $target
    while (-not $cursor.Equals($AncestorState.Path, [StringComparison]::OrdinalIgnoreCase)) {
        $missing.Add($cursor)
        $cursor = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($cursor)) { throw "$Label escaped its verified ancestor: $target" }
    }
    $parentState = $AncestorState
    for ($index = $missing.Count - 1; $index -ge 0; $index--) {
        $child = $missing[$index]
        $null = Assert-PathState -Expected $parentState -Label "$Label parent"
        $absent = Get-PathState -Path $child -ExpectedType 'Any' -Label $Label
        if ($absent.Exists) { throw "$Label appeared before creation: $child" }
        $verifiedParentState = $parentState
        [IO.Directory]::CreateDirectory($child) | Out-Null
        $null = Assert-PathState -Expected $parentState -Label "$Label parent after creation"
        $parentState = Get-PathState -Path $child -ExpectedType 'Directory' -Label $Label
        if ($null -ne $CreatedDirectories) {
            $null = $CreatedDirectories.Add([pscustomobject]@{ State = $parentState; ParentState = $verifiedParentState })
        }
    }
    return $parentState
}

function Get-SafeChildPath {
    param([string]$Parent, [string]$BaseName, [string]$Label)
    if ([string]::IsNullOrWhiteSpace($BaseName) -or $BaseName -ne [IO.Path]::GetFileName($BaseName)) {
        throw "$Label must be a safe basename: $BaseName"
    }
    Assert-ExistingComponentsSafe -Path $Parent -Label "$Label parent"
    $child = Get-FullPath (Join-Path $Parent $BaseName)
    Assert-WithinRoot -Path $child -Root $Parent -Label $Label
    return $child
}

function Get-RelativeFiles {
    param([string]$BasePath)
    $baseState = Get-PathState -Path $BasePath -ExpectedType 'Directory' -Label 'Directory mirror'
    $files = @(Get-ChildItem -LiteralPath $BasePath -Recurse -Force | ForEach-Object {
        if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Directory mirror contains an unsafe symbolic link, junction, or reparse point: $($_.FullName)"
        }
        if (-not $_.PSIsContainer) { $_.FullName.Substring($baseState.Path.Length + 1) }
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

function Assert-FileHash {
    param([string]$Expected, [string]$Actual, [string]$Label)
    $expectedHash = (Get-FileHash -LiteralPath $Expected -Algorithm SHA256).Hash
    $actualHash = (Get-FileHash -LiteralPath $Actual -Algorithm SHA256).Hash
    if ($expectedHash -ne $actualHash) { throw "$Label hash mismatch" }
}

function Move-VerifiedItem {
    param([psobject]$SourceState, [psobject]$DestinationState, [psobject]$ParentState, [string]$Label)
    if (-not $SourceState.Exists -or $DestinationState.Exists) { throw "$Label requires an existing source and absent destination." }
    $null = Assert-PathState -Expected $ParentState -Label "$Label parent before move"
    $null = Assert-PathState -Expected $SourceState -Label "$Label source before move"
    $null = Assert-PathState -Expected $DestinationState -Label "$Label destination before move"
    Move-Item -LiteralPath $SourceState.Path -Destination $DestinationState.Path
    $null = Assert-PathState -Expected $ParentState -Label "$Label parent after move"
    $sourceAfter = Get-PathState -Path $SourceState.Path -ExpectedType 'Any' -Label "$Label source after move"
    if ($sourceAfter.Exists) { throw "$Label source still exists after move: $($SourceState.Path)" }
    $destinationAfter = Get-PathState -Path $DestinationState.Path -ExpectedType $SourceState.Type -Label "$Label destination after move"
    if ($destinationAfter.Identity -ne $SourceState.Identity) { throw "$Label changed identity during same-parent move." }
    return $destinationAfter
}

function Remove-VerifiedItem {
    param([psobject]$State, [psobject]$ParentState, [switch]$Recurse, [string]$Label)
    if (-not $State.Exists) { return }
    $null = Assert-PathState -Expected $ParentState -Label "$Label parent before removal"
    $null = Assert-PathState -Expected $State -Label "$Label before removal"
    if ($Recurse) { Remove-Item -LiteralPath $State.Path -Recurse -Force } else { Remove-Item -LiteralPath $State.Path -Force }
    $null = Assert-PathState -Expected $ParentState -Label "$Label parent after removal"
    $after = Get-PathState -Path $State.Path -ExpectedType 'Any' -Label "$Label after removal"
    if ($after.Exists) { throw "$Label still exists after removal: $($State.Path)" }
}

function Remove-RegisteredPaths {
    param([Collections.IList]$Records, [string]$Label)
    for ($index = $Records.Count - 1; $index -ge 0; $index--) {
        $record = $Records[$index]
        $state = Get-PathState -Path $record.Path -ExpectedType 'Any' -Label $Label
        if ($state.Exists) {
            Remove-VerifiedItem -State $state -ParentState $record.ParentState -Recurse:$record.Recurse -Label $Label
        }
    }
}

function Remove-CreatedEmptyDirectories {
    param([Collections.IList]$Records, [string]$Label)
    for ($index = $Records.Count - 1; $index -ge 0; $index--) {
        $record = $Records[$index]
        $state = Get-PathState -Path $record.State.Path -ExpectedType 'Directory' -Label $Label
        if (-not $state.Exists) { continue }
        $null = Assert-PathState -Expected $record.State -Label $Label
        if (@(Get-ChildItem -LiteralPath $state.Path -Force).Count -eq 0) {
            Remove-VerifiedItem -State $state -ParentState $record.ParentState -Label $Label
        }
    }
}

foreach ($required in @($packageRoot, $sourceSkill, $sourceAgentsRoot, $manifestPath, $verifyScript)) {
    if ($null -eq (Get-ItemIfPresent $required)) { throw "Required package path is missing: $required" }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required to validate the package.' }
$packageState = Get-PathState -Path $packageRoot -ExpectedType 'Directory' -Label 'Package root'
$sourceSkillState = Get-PathState -Path $sourceSkill -ExpectedType 'Directory' -Label 'Package skill source'
$sourceAgentsRootState = Get-PathState -Path $sourceAgentsRoot -ExpectedType 'Directory' -Label 'Package agent source directory'
$manifestState = Get-PathState -Path $manifestPath -ExpectedType 'File' -Label 'Agent manifest'
$verifyState = Get-PathState -Path $verifyScript -ExpectedType 'File' -Label 'Package verifier'

$verificationOutput = & node $verifyScript 2>&1
if ($LASTEXITCODE -ne 0) { throw "Package verification failed before installation: $($verificationOutput -join [Environment]::NewLine)" }
$null = Assert-PathState -Expected $packageState -Label 'Package root after verification'
$null = Assert-PathState -Expected $manifestState -Label 'Agent manifest after verification'

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
$CodexHome = Get-FullPath $CodexHome
Assert-ExistingComponentsSafe -Path $CodexHome -Label 'Codex home'
Assert-Disjoint -First $CodexHome -Second $packageRoot -Label 'Codex home and package root'
$codexAncestorState = Get-ExistingAncestorState -Path $CodexHome -Label 'Codex home'
$destinationSkillsRoot = Get-FullPath (Join-Path $CodexHome 'skills')
$destinationSkill = Get-SafeChildPath -Parent $destinationSkillsRoot -BaseName 'information-accessibility-practice' -Label 'Skill destination'
$destinationAgentsRoot = Get-FullPath (Join-Path $CodexHome 'agents')

$agentIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$sourcePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$destinationPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$installAgents = foreach ($agent in $selectedAgents) {
    $id = [string]$agent.id
    if ($id -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)*$') { throw "Manifest agent id is not a safe basename: $id" }
    if (-not $agentIds.Add($id)) { throw "Duplicate selected manifest agent id: $id" }
    $source = Get-SafeChildPath -Parent $sourceAgentsRoot -BaseName "$id.toml" -Label "Package agent source for $id"
    Assert-WithinRoot -Path $source -Root $sourceAgentsRoot -Label "Package agent source for $id"
    $sourceState = Get-PathState -Path $source -ExpectedType 'File' -Label "Package agent source for $id"
    $destination = Get-SafeChildPath -Parent $destinationAgentsRoot -BaseName "$id.toml" -Label "Agent destination for $id"
    if (-not $sourcePaths.Add($source)) { throw "Duplicate selected agent source path: $source" }
    if (-not $destinationPaths.Add($destination)) { throw "Duplicate selected agent destination path: $destination" }
    [pscustomobject]@{
        Agent = $agent
        Id = $id
        Source = $source
        SourceState = $sourceState
        Destination = $destination
        OriginalState = $null
        Staged = $null
        StagedState = $null
        Backup = $null
        BackupState = $null
        Incoming = $null
        Old = $null
        OldState = $null
        InstalledState = $null
    }
}

$skillOriginalState = Get-PathState -Path $destinationSkill -ExpectedType 'Directory' -Label 'Skill destination'
foreach ($entry in $installAgents) {
    $entry.OriginalState = Get-PathState -Path $entry.Destination -ExpectedType 'File' -Label "Agent destination for $($entry.Id)"
}
$needsBackup = $skillOriginalState.Exists -or (@($installAgents | Where-Object { $_.OriginalState.Exists }).Count -gt 0)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
    $BackupRoot = Join-Path (Split-Path -Parent $CodexHome) "codex-backups\information-accessibility-practice\$timestamp"
}
$BackupRoot = Get-FullPath $BackupRoot
Assert-ExistingComponentsSafe -Path $BackupRoot -Label 'Backup root'
Assert-Disjoint -First $BackupRoot -Second $packageRoot -Label 'Backup root and package root'
Assert-Disjoint -First $BackupRoot -Second $CodexHome -Label 'Backup root and Codex home'
$backupOriginalState = Get-PathState -Path $BackupRoot -ExpectedType 'Any' -Label 'Backup root'
if ($backupOriginalState.Exists) { throw "Backup root already exists; choose a new empty path: $BackupRoot" }
$backupAncestorState = Get-ExistingAncestorState -Path $BackupRoot -Label 'Backup root'
$sourceFileCount = @(Get-RelativeFiles -BasePath $sourceSkill).Count

if ($WhatIfPreference) {
    [pscustomobject]@{
        Status = 'WHAT_IF'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        SelectedAgentIds = @($installAgents | ForEach-Object { $_.Id })
        AgentDestinations = @($installAgents | ForEach-Object { $_.Destination })
        BackupRoot = $BackupRoot
        SourceSkillFiles = $sourceFileCount
    } | ConvertTo-Json -Depth 3
    return
}

$stageParent = Get-FullPath ([IO.Path]::GetTempPath())
$stageParentState = Get-PathState -Path $stageParent -ExpectedType 'Directory' -Label 'Installer staging parent'
$stageRoot = Get-FullPath (Join-Path $stageParent ("information-accessibility-install-" + [guid]::NewGuid().ToString('N')))
Assert-Disjoint -First $stageRoot -Second $packageRoot -Label 'Installer staging and package root'
Assert-Disjoint -First $stageRoot -Second $CodexHome -Label 'Installer staging and Codex home'
Assert-Disjoint -First $stageRoot -Second $BackupRoot -Label 'Installer staging and backup root'
$stageOriginalState = Get-PathState -Path $stageRoot -ExpectedType 'Any' -Label 'Installer staging root'
$stageState = $null
$stageSkill = Join-Path $stageRoot 'skill'
$stageAgentsRoot = Join-Path $stageRoot 'agents'
$backupSkill = Join-Path $BackupRoot 'skill'
$backupAgentsRoot = Join-Path $BackupRoot 'agents'
$createdDestinationDirectories = [Collections.Generic.List[object]]::new()
$createdBackupDirectories = [Collections.Generic.List[object]]::new()
$backupArtifacts = [Collections.Generic.List[object]]::new()
$copyMutationRecords = [Collections.Generic.List[object]]::new()
$skillRecord = $null
$transactionStarted = $false
$transactionSucceeded = $false
$rollbackSucceeded = $false

try {
    $null = Assert-PathState -Expected $stageParentState -Label 'Installer staging parent before creation'
    $stageState = Ensure-VerifiedDirectory -Path $stageRoot -AncestorState $stageParentState -Label 'Installer staging root'
    $null = Assert-PathState -Expected $sourceSkillState -Label 'Package skill source before staging'
    $null = Assert-PathState -Expected $stageState -Label 'Installer staging root before skill copy'
    Copy-Item -LiteralPath $sourceSkill -Destination $stageSkill -Recurse
    $null = Assert-PathState -Expected $sourceSkillState -Label 'Package skill source after staging copy'
    $null = Assert-PathState -Expected $stageState -Label 'Installer staging root after skill copy'
    $stageSkillState = Get-PathState -Path $stageSkill -ExpectedType 'Directory' -Label 'Staged skill'
    $null = Assert-DirectoryMirror -Expected $sourceSkill -Actual $stageSkill
    $null = Assert-PathState -Expected $stageState -Label 'Installer staging root before agent directory creation'
    $stageAgentsAbsent = Get-PathState -Path $stageAgentsRoot -ExpectedType 'Any' -Label 'Staged agents root'
    if ($stageAgentsAbsent.Exists) { throw "Staged agents root appeared before creation: $stageAgentsRoot" }
    [IO.Directory]::CreateDirectory($stageAgentsRoot) | Out-Null
    $null = Assert-PathState -Expected $stageState -Label 'Installer staging root after agent directory creation'
    $stageAgentsRootState = Get-PathState -Path $stageAgentsRoot -ExpectedType 'Directory' -Label 'Staged agents root'
    foreach ($entry in $installAgents) {
        $null = Assert-PathState -Expected $entry.SourceState -Label "Package agent source for $($entry.Id) before staging"
        $null = Assert-PathState -Expected $stageAgentsRootState -Label "Staged agents root before copying $($entry.Id)"
        $staged = Join-Path $stageAgentsRoot "$($entry.Id).toml"
        $stagedAbsent = Get-PathState -Path $staged -ExpectedType 'Any' -Label "Staged agent $($entry.Id)"
        if ($stagedAbsent.Exists) { throw "Staged agent appeared before copy: $staged" }
        Copy-Item -LiteralPath $entry.Source -Destination $staged
        $null = Assert-PathState -Expected $entry.SourceState -Label "Package agent source for $($entry.Id) after staging"
        $null = Assert-PathState -Expected $stageAgentsRootState -Label "Staged agents root after copying $($entry.Id)"
        $stagedState = Get-PathState -Path $staged -ExpectedType 'File' -Label "Staged agent $($entry.Id)"
        Assert-FileHash -Expected $entry.Source -Actual $staged -Label "Staged agent $($entry.Id)"
        $entry.Staged = $staged
        $entry.StagedState = $stagedState
    }
    $null = Assert-PathState -Expected $stageSkillState -Label 'Staged skill after staging'
    $null = Assert-PathState -Expected $stageAgentsRootState -Label 'Staged agents root after staging'

    if (-not $PSCmdlet.ShouldProcess($CodexHome, "Install information accessibility skill and $($installAgents.Count) manifest-selected agents")) { return }

    $null = Assert-PathState -Expected $packageState -Label 'Package root before backup'
    $null = Assert-PathState -Expected $sourceSkillState -Label 'Package skill source before backup'
    $null = Assert-PathState -Expected $codexAncestorState -Label 'Codex home ancestor before backup'
    $codexHomeState = Ensure-VerifiedDirectory -Path $CodexHome -AncestorState $codexAncestorState -Label 'Codex home' -CreatedDirectories $createdDestinationDirectories
    $null = Assert-PathState -Expected $skillOriginalState -Label 'Skill destination before backup'
    foreach ($entry in $installAgents) { $null = Assert-PathState -Expected $entry.OriginalState -Label "Agent destination for $($entry.Id) before backup" }
    $backupState = $null
    $backupAgentsState = $null
    if ($needsBackup) {
        $backupState = Ensure-VerifiedDirectory -Path $BackupRoot -AncestorState $backupAncestorState -Label 'Backup root' -CreatedDirectories $createdBackupDirectories
        if ($skillOriginalState.Exists) {
            $null = Assert-PathState -Expected $skillOriginalState -Label 'Skill destination during backup'
            $null = Assert-PathState -Expected $backupState -Label 'Backup root before skill backup'
            $backupSkillAbsent = Get-PathState -Path $backupSkill -ExpectedType 'Any' -Label 'Skill backup destination'
            if ($backupSkillAbsent.Exists) { throw "Skill backup destination appeared before copy: $backupSkill" }
            $null = $backupArtifacts.Add([pscustomobject]@{ Path = $backupSkill; ParentState = $backupState; Recurse = $true })
            Copy-Item -LiteralPath $destinationSkill -Destination $backupSkill -Recurse
            $null = Assert-PathState -Expected $skillOriginalState -Label 'Skill destination after backup copy'
            $null = Assert-PathState -Expected $backupState -Label 'Backup root after skill backup'
            $backupSkillState = Get-PathState -Path $backupSkill -ExpectedType 'Directory' -Label 'Skill backup'
            $null = Assert-DirectoryMirror -Expected $destinationSkill -Actual $backupSkill
        }
        foreach ($entry in $installAgents) {
            if (-not $entry.OriginalState.Exists) { continue }
            if ($null -eq $backupAgentsState) {
                $backupAgentsState = Ensure-VerifiedDirectory -Path $backupAgentsRoot -AncestorState $backupState -Label 'Agent backup root' -CreatedDirectories $createdBackupDirectories
            }
            $backup = Join-Path $backupAgentsRoot "$($entry.Id).toml"
            $null = Assert-PathState -Expected $entry.OriginalState -Label "Agent destination for $($entry.Id) during backup"
            $null = Assert-PathState -Expected $backupAgentsState -Label "Agent backup root before copying $($entry.Id)"
            $backupAbsent = Get-PathState -Path $backup -ExpectedType 'Any' -Label "Agent backup destination for $($entry.Id)"
            if ($backupAbsent.Exists) { throw "Agent backup destination appeared before copy: $backup" }
            $null = $backupArtifacts.Add([pscustomobject]@{ Path = $backup; ParentState = $backupAgentsState; Recurse = $false })
            Copy-Item -LiteralPath $entry.Destination -Destination $backup
            $null = Assert-PathState -Expected $entry.OriginalState -Label "Agent destination for $($entry.Id) after backup copy"
            $null = Assert-PathState -Expected $backupAgentsState -Label "Agent backup root after copying $($entry.Id)"
            $backupFileState = Get-PathState -Path $backup -ExpectedType 'File' -Label "Agent backup for $($entry.Id)"
            Assert-FileHash -Expected $entry.Destination -Actual $backup -Label "Agent backup for $($entry.Id)"
            $entry.Backup = $backup
            $entry.BackupState = $backupFileState
        }
    }
    if ($skillOriginalState.Exists) { $null = Assert-DirectoryMirror -Expected $destinationSkill -Actual $backupSkill }
    foreach ($entry in $installAgents) {
        if ($entry.OriginalState.Exists) { Assert-FileHash -Expected $entry.Destination -Actual $entry.Backup -Label "Verified backup for $($entry.Id)" }
    }

    $skillsRootState = Ensure-VerifiedDirectory -Path $destinationSkillsRoot -AncestorState $codexHomeState -Label 'Codex skills root' -CreatedDirectories $createdDestinationDirectories
    $agentsRootState = Ensure-VerifiedDirectory -Path $destinationAgentsRoot -AncestorState $codexHomeState -Label 'Codex agents root' -CreatedDirectories $createdDestinationDirectories
    $null = Assert-PathState -Expected $skillOriginalState -Label 'Skill destination immediately before transaction'
    foreach ($entry in $installAgents) { $null = Assert-PathState -Expected $entry.OriginalState -Label "Agent destination for $($entry.Id) immediately before transaction" }
    $transactionStarted = $true

    $skillIncoming = Join-Path $destinationSkillsRoot (".information-accessibility-practice.install-" + [guid]::NewGuid().ToString('N'))
    $skillOld = Join-Path $destinationSkillsRoot (".information-accessibility-practice.rollback-" + [guid]::NewGuid().ToString('N'))
    foreach ($path in @($skillIncoming, $skillOld)) {
        Assert-Disjoint -First $path -Second $destinationSkill -Label 'Skill mutation path and destination'
        Assert-Disjoint -First $path -Second $packageRoot -Label 'Skill mutation path and package root'
        Assert-Disjoint -First $path -Second $BackupRoot -Label 'Skill mutation path and backup root'
    }
    $skillIncomingAbsent = Get-PathState -Path $skillIncoming -ExpectedType 'Any' -Label 'Skill incoming path'
    $skillOldAbsent = Get-PathState -Path $skillOld -ExpectedType 'Any' -Label 'Skill rollback path'
    $skillRecord = [pscustomobject]@{ Incoming = $skillIncoming; Old = $skillOld; OldState = $null; ParentState = $skillsRootState }
    $null = $copyMutationRecords.Add([pscustomobject]@{ Path = $skillIncoming; ParentState = $skillsRootState; Recurse = $true })
    $null = Assert-PathState -Expected $stageSkillState -Label 'Staged skill before incoming copy'
    $null = Assert-PathState -Expected $skillsRootState -Label 'Codex skills root before incoming copy'
    $null = Assert-PathState -Expected $skillIncomingAbsent -Label 'Skill incoming path before copy'
    Copy-Item -LiteralPath $stageSkill -Destination $skillIncoming -Recurse
    $null = Assert-PathState -Expected $stageSkillState -Label 'Staged skill after incoming copy'
    $null = Assert-PathState -Expected $skillsRootState -Label 'Codex skills root after incoming copy'
    $skillIncomingState = Get-PathState -Path $skillIncoming -ExpectedType 'Directory' -Label 'Skill incoming path'
    $null = Assert-DirectoryMirror -Expected $stageSkill -Actual $skillIncoming
    if ($skillOriginalState.Exists) {
        $null = Assert-DirectoryMirror -Expected $backupSkill -Actual $destinationSkill
        $skillOldState = Move-VerifiedItem -SourceState $skillOriginalState -DestinationState $skillOldAbsent -ParentState $skillsRootState -Label 'Preserve old skill'
        $skillRecord.OldState = $skillOldState
    }
    $skillDestinationAbsent = Get-PathState -Path $destinationSkill -ExpectedType 'Any' -Label 'Skill destination before activation'
    $installedSkillState = Move-VerifiedItem -SourceState $skillIncomingState -DestinationState $skillDestinationAbsent -ParentState $skillsRootState -Label 'Activate staged skill'
    $null = Assert-DirectoryMirror -Expected $stageSkill -Actual $destinationSkill

    foreach ($entry in $installAgents) {
        $incoming = Join-Path $destinationAgentsRoot (".$($entry.Id).install-" + [guid]::NewGuid().ToString('N'))
        $old = Join-Path $destinationAgentsRoot (".$($entry.Id).rollback-" + [guid]::NewGuid().ToString('N'))
        foreach ($path in @($incoming, $old)) {
            Assert-Disjoint -First $path -Second $entry.Destination -Label "Agent mutation path and destination for $($entry.Id)"
            Assert-Disjoint -First $path -Second $packageRoot -Label "Agent mutation path and package root for $($entry.Id)"
            Assert-Disjoint -First $path -Second $BackupRoot -Label "Agent mutation path and backup root for $($entry.Id)"
        }
        $incomingAbsent = Get-PathState -Path $incoming -ExpectedType 'Any' -Label "Agent incoming path for $($entry.Id)"
        $oldAbsent = Get-PathState -Path $old -ExpectedType 'Any' -Label "Agent rollback path for $($entry.Id)"
        $entry.Incoming = $incoming
        $entry.Old = $old
        $entry.OldState = $null
        $null = $copyMutationRecords.Add([pscustomobject]@{ Path = $incoming; ParentState = $agentsRootState; Recurse = $false })
        $null = Assert-PathState -Expected $entry.StagedState -Label "Staged agent $($entry.Id) before incoming copy"
        $null = Assert-PathState -Expected $agentsRootState -Label "Codex agents root before incoming copy for $($entry.Id)"
        $null = Assert-PathState -Expected $incomingAbsent -Label "Agent incoming path for $($entry.Id) before copy"
        Copy-Item -LiteralPath $entry.Staged -Destination $incoming
        $null = Assert-PathState -Expected $entry.StagedState -Label "Staged agent $($entry.Id) after incoming copy"
        $null = Assert-PathState -Expected $agentsRootState -Label "Codex agents root after incoming copy for $($entry.Id)"
        $incomingState = Get-PathState -Path $incoming -ExpectedType 'File' -Label "Agent incoming path for $($entry.Id)"
        Assert-FileHash -Expected $entry.Staged -Actual $incoming -Label "Agent incoming path for $($entry.Id)"
        if ($entry.OriginalState.Exists) {
            Assert-FileHash -Expected $entry.Backup -Actual $entry.Destination -Label "Agent prestate for $($entry.Id)"
            $oldState = Move-VerifiedItem -SourceState $entry.OriginalState -DestinationState $oldAbsent -ParentState $agentsRootState -Label "Preserve old agent $($entry.Id)"
            $entry.OldState = $oldState
        }
        $destinationAbsent = Get-PathState -Path $entry.Destination -ExpectedType 'Any' -Label "Agent destination for $($entry.Id) before activation"
        $installedState = Move-VerifiedItem -SourceState $incomingState -DestinationState $destinationAbsent -ParentState $agentsRootState -Label "Activate staged agent $($entry.Id)"
        $entry.InstalledState = $installedState
        Assert-FileHash -Expected $entry.Source -Actual $entry.Destination -Label "Installed agent $($entry.Id)"
    }

    $installedFileCount = Assert-DirectoryMirror -Expected $sourceSkill -Actual $destinationSkill
    foreach ($entry in $installAgents) { Assert-FileHash -Expected $entry.Source -Actual $entry.Destination -Label "Installed agent $($entry.Id)" }

    if ($null -ne $skillRecord.OldState) { Remove-VerifiedItem -State $skillRecord.OldState -ParentState $skillsRootState -Recurse -Label 'Old skill cleanup' }
    foreach ($entry in $installAgents) {
        if ($null -ne $entry.OldState) { Remove-VerifiedItem -State $entry.OldState -ParentState $agentsRootState -Label "Old agent cleanup for $($entry.Id)" }
    }
    $transactionSucceeded = $true

    [pscustomobject]@{
        Status = 'PASS'
        CodexHome = $CodexHome
        SkillDestination = $destinationSkill
        SelectedAgentIds = @($installAgents | ForEach-Object { $_.Id }) -join ', '
        AgentDestinations = @($installAgents | ForEach-Object { $_.Destination }) -join [Environment]::NewLine
        BackupRoot = $BackupRoot
        InstalledSkillFiles = $installedFileCount
        PreviousSkillBackedUp = $skillOriginalState.Exists
        PreviousAgentsBackedUp = @($installAgents | Where-Object { $_.OriginalState.Exists }).Count
    } | Format-List
} catch {
    $installError = $_
    if ($transactionStarted -and -not $transactionSucceeded) {
        try {
            if ($null -ne $skillRecord) {
                $currentSkill = Get-PathState -Path $destinationSkill -ExpectedType 'Directory' -Label 'Skill rollback destination'
                if ($skillOriginalState.Exists) {
                    $oldSkillCurrent = if ($null -ne $skillRecord.OldState) { Get-PathState -Path $skillRecord.Old -ExpectedType 'Directory' -Label 'Old skill rollback source' } else { $null }
                    if ($null -ne $oldSkillCurrent -and $oldSkillCurrent.Exists) {
                        if ($currentSkill.Exists) { Remove-VerifiedItem -State $currentSkill -ParentState $skillsRootState -Recurse -Label 'Installed skill rollback removal' }
                        $skillAbsent = Get-PathState -Path $destinationSkill -ExpectedType 'Any' -Label 'Skill rollback destination'
                        $restoredSkillState = Move-VerifiedItem -SourceState $oldSkillCurrent -DestinationState $skillAbsent -ParentState $skillsRootState -Label 'Restore old skill'
                    } else {
                        $skillAlreadyRestored = $false
                        if ($currentSkill.Exists) {
                            try { $null = Assert-DirectoryMirror -Expected $backupSkill -Actual $destinationSkill; $skillAlreadyRestored = $true } catch { $skillAlreadyRestored = $false }
                        }
                        if (-not $skillAlreadyRestored) {
                            $restoreIncoming = Join-Path $destinationSkillsRoot (".information-accessibility-practice.restore-" + [guid]::NewGuid().ToString('N'))
                            Assert-Disjoint -First $restoreIncoming -Second $destinationSkill -Label 'Skill restore path and destination'
                            Assert-Disjoint -First $restoreIncoming -Second $packageRoot -Label 'Skill restore path and package root'
                            Assert-Disjoint -First $restoreIncoming -Second $BackupRoot -Label 'Skill restore path and backup root'
                            $restoreAbsent = Get-PathState -Path $restoreIncoming -ExpectedType 'Any' -Label 'Skill restore incoming path'
                            $null = $copyMutationRecords.Add([pscustomobject]@{ Path = $restoreIncoming; ParentState = $skillsRootState; Recurse = $true })
                            $null = Assert-PathState -Expected $backupSkillState -Label 'Skill backup before restore copy'
                            $null = Assert-PathState -Expected $skillsRootState -Label 'Codex skills root before restore copy'
                            Copy-Item -LiteralPath $backupSkill -Destination $restoreIncoming -Recurse
                            $null = Assert-PathState -Expected $backupSkillState -Label 'Skill backup after restore copy'
                            $null = Assert-PathState -Expected $skillsRootState -Label 'Codex skills root after restore copy'
                            $restoreState = Get-PathState -Path $restoreIncoming -ExpectedType 'Directory' -Label 'Skill restore incoming path'
                            $null = Assert-DirectoryMirror -Expected $backupSkill -Actual $restoreIncoming
                            if ($currentSkill.Exists) { Remove-VerifiedItem -State $currentSkill -ParentState $skillsRootState -Recurse -Label 'Installed skill rollback removal' }
                            $skillAbsent = Get-PathState -Path $destinationSkill -ExpectedType 'Any' -Label 'Skill rollback destination'
                            $restoredSkillState = Move-VerifiedItem -SourceState $restoreState -DestinationState $skillAbsent -ParentState $skillsRootState -Label 'Restore skill from backup'
                        }
                    }
                    $null = Assert-DirectoryMirror -Expected $backupSkill -Actual $destinationSkill
                } elseif ($currentSkill.Exists) {
                    Remove-VerifiedItem -State $currentSkill -ParentState $skillsRootState -Recurse -Label 'New skill rollback removal'
                }
            }
            foreach ($entry in $installAgents) {
                $current = Get-PathState -Path $entry.Destination -ExpectedType 'File' -Label "Agent rollback destination for $($entry.Id)"
                if ($entry.OriginalState.Exists) {
                    $oldCurrent = if ($null -ne $entry.Old) { Get-PathState -Path $entry.Old -ExpectedType 'File' -Label "Old agent rollback source for $($entry.Id)" } else { $null }
                    if ($null -ne $oldCurrent -and $oldCurrent.Exists) {
                        if ($current.Exists) { Remove-VerifiedItem -State $current -ParentState $agentsRootState -Label "Installed agent rollback removal for $($entry.Id)" }
                        $absent = Get-PathState -Path $entry.Destination -ExpectedType 'Any' -Label "Agent rollback destination for $($entry.Id)"
                        $restoredState = Move-VerifiedItem -SourceState $oldCurrent -DestinationState $absent -ParentState $agentsRootState -Label "Restore old agent $($entry.Id)"
                    } else {
                        $agentAlreadyRestored = $false
                        if ($current.Exists) {
                            $agentAlreadyRestored = (Get-FileHash -LiteralPath $entry.Backup -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $entry.Destination -Algorithm SHA256).Hash
                        }
                        if (-not $agentAlreadyRestored) {
                            $restoreIncoming = Join-Path $destinationAgentsRoot (".$($entry.Id).restore-" + [guid]::NewGuid().ToString('N'))
                            Assert-Disjoint -First $restoreIncoming -Second $entry.Destination -Label "Agent restore path and destination for $($entry.Id)"
                            Assert-Disjoint -First $restoreIncoming -Second $packageRoot -Label "Agent restore path and package root for $($entry.Id)"
                            Assert-Disjoint -First $restoreIncoming -Second $BackupRoot -Label "Agent restore path and backup root for $($entry.Id)"
                            $restoreAbsent = Get-PathState -Path $restoreIncoming -ExpectedType 'Any' -Label "Agent restore incoming path for $($entry.Id)"
                            $null = $copyMutationRecords.Add([pscustomobject]@{ Path = $restoreIncoming; ParentState = $agentsRootState; Recurse = $false })
                            $null = Assert-PathState -Expected $entry.BackupState -Label "Agent backup before restore copy for $($entry.Id)"
                            $null = Assert-PathState -Expected $agentsRootState -Label "Codex agents root before restore copy for $($entry.Id)"
                            Copy-Item -LiteralPath $entry.Backup -Destination $restoreIncoming
                            $null = Assert-PathState -Expected $entry.BackupState -Label "Agent backup after restore copy for $($entry.Id)"
                            $null = Assert-PathState -Expected $agentsRootState -Label "Codex agents root after restore copy for $($entry.Id)"
                            $restoreState = Get-PathState -Path $restoreIncoming -ExpectedType 'File' -Label "Agent restore incoming path for $($entry.Id)"
                            Assert-FileHash -Expected $entry.Backup -Actual $restoreIncoming -Label "Agent restore incoming path for $($entry.Id)"
                            if ($current.Exists) { Remove-VerifiedItem -State $current -ParentState $agentsRootState -Label "Installed agent rollback removal for $($entry.Id)" }
                            $absent = Get-PathState -Path $entry.Destination -ExpectedType 'Any' -Label "Agent rollback destination for $($entry.Id)"
                            $restoredState = Move-VerifiedItem -SourceState $restoreState -DestinationState $absent -ParentState $agentsRootState -Label "Restore agent from backup $($entry.Id)"
                        }
                    }
                    Assert-FileHash -Expected $entry.Backup -Actual $entry.Destination -Label "Restored agent $($entry.Id)"
                } elseif ($current.Exists) {
                    Remove-VerifiedItem -State $current -ParentState $agentsRootState -Label "New agent rollback removal for $($entry.Id)"
                }
            }
            if ($skillOriginalState.Exists) { $null = Assert-DirectoryMirror -Expected $backupSkill -Actual $destinationSkill }
            foreach ($entry in $installAgents) {
                if ($entry.OriginalState.Exists) { Assert-FileHash -Expected $entry.Backup -Actual $entry.Destination -Label "Rollback verification for $($entry.Id)" }
                elseif ((Get-PathState -Path $entry.Destination -ExpectedType 'Any' -Label "Rollback verification for $($entry.Id)").Exists) { throw "Rollback left an originally absent agent: $($entry.Id)" }
            }
            $rollbackSucceeded = $true
        } catch {
            throw "Installation failed: $($installError.Exception.Message). Rollback also failed: $($_.Exception.Message)"
        }
    }
    throw $installError
} finally {
    if ($null -ne $stageState) {
        $currentStage = Get-PathState -Path $stageRoot -ExpectedType 'Directory' -Label 'Installer staging cleanup'
        if ($currentStage.Exists) { Remove-VerifiedItem -State $currentStage -ParentState $stageParentState -Recurse -Label 'Installer staging cleanup' }
    }
    if ($copyMutationRecords.Count -gt 0) {
        Remove-RegisteredPaths -Records $copyMutationRecords -Label 'Installer copy mutation cleanup'
    }
    if (-not $transactionStarted -and -not $transactionSucceeded) {
        if ($backupArtifacts.Count -gt 0) {
            Remove-RegisteredPaths -Records $backupArtifacts -Label 'Pre-transaction backup cleanup'
        }
        if ($createdBackupDirectories.Count -gt 0) {
            Remove-CreatedEmptyDirectories -Records $createdBackupDirectories -Label 'Pre-transaction backup directory cleanup'
        }
        if ($createdDestinationDirectories.Count -gt 0) {
            Remove-CreatedEmptyDirectories -Records $createdDestinationDirectories -Label 'Pre-transaction destination directory cleanup'
        }
    }
    if ($rollbackSucceeded) {
        if ($null -ne $skillRecord) {
            foreach ($path in @($skillRecord.Old)) {
                if ([string]::IsNullOrWhiteSpace($path)) { continue }
                $state = Get-PathState -Path $path -ExpectedType 'Any' -Label 'Skill transaction cleanup'
                if ($state.Exists) { Remove-VerifiedItem -State $state -ParentState $skillsRootState -Recurse -Label 'Skill transaction cleanup' }
            }
        }
        foreach ($entry in $installAgents) {
            foreach ($path in @($entry.Old)) {
                if ([string]::IsNullOrWhiteSpace($path)) { continue }
                $state = Get-PathState -Path $path -ExpectedType 'Any' -Label "Agent transaction cleanup for $($entry.Id)"
                if ($state.Exists) { Remove-VerifiedItem -State $state -ParentState $agentsRootState -Label "Agent transaction cleanup for $($entry.Id)" }
            }
        }
    }
}
