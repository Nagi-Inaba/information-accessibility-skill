[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $ReportPath,

  [Parameter(Mandatory = $true)]
  [string] $NvdaDownloadUrl,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{64}$')]
  [string] $NvdaSha256,

  [Parameter(Mandatory = $true)]
  [string] $OutputDirectory,

  [string] $NvdaVersion = '2026.1.1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-EdgeExecutable {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
  if ($candidates.Count -eq 0) {
    $command = Get-Command msedge.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Microsoft Edge executable was not found on the Windows runner.'
  }
  return $candidates[0]
}

function Wait-NvdaRunning {
  param([Parameter(Mandatory = $true)][string] $NvdaExecutable)
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $check = Start-Process -FilePath $NvdaExecutable -ArgumentList @('--check-running') -Wait -PassThru -WindowStyle Hidden
    if ($check.ExitCode -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'NVDA did not report a running instance through --check-running.'
}

function Activate-ReportWindow {
  param(
    [Parameter(Mandatory = $true)] $Shell,
    [Parameter(Mandatory = $true)][datetime] $StartedAt
  )
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    $candidates = Get-Process msedge -ErrorAction SilentlyContinue | Where-Object {
      try { $_.StartTime -ge $StartedAt.AddSeconds(-2) -and $_.MainWindowTitle -match 'Audit Report' } catch { $false }
    }
    foreach ($candidate in $candidates) {
      if ($Shell.AppActivate($candidate.Id)) {
        return $candidate.Id
      }
    }
    if ($Shell.AppActivate('WCAG 2.2 A/AA Audit Report')) {
      return 0
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'The generated report window could not be activated in Microsoft Edge.'
}

function Send-SmokeGestures {
  param([Parameter(Mandatory = $true)] $Shell)
  $steps = @(
    [ordered]@{ name = 'document-start'; keys = '^{HOME}'; delay_ms = 800 },
    [ordered]@{ name = 'focus-skip-link'; keys = '{TAB}'; delay_ms = 1000 },
    [ordered]@{ name = 'activate-skip-link'; keys = '{ENTER}'; delay_ms = 1000 },
    [ordered]@{ name = 'next-heading'; keys = 'h'; delay_ms = 1000 },
    [ordered]@{ name = 'second-heading'; keys = 'h'; delay_ms = 1000 },
    [ordered]@{ name = 'next-table'; keys = 't'; delay_ms = 1400 },
    [ordered]@{ name = 'next-link'; keys = 'k'; delay_ms = 1000 },
    [ordered]@{ name = 'next-focusable'; keys = '{TAB}'; delay_ms = 1000 }
  )
  foreach ($step in $steps) {
    $Shell.SendKeys($step.keys)
    Start-Sleep -Milliseconds $step.delay_ms
  }
  return $steps
}

function Read-SpeechEvidence {
  param([Parameter(Mandatory = $true)][string] $LogPath)
  if (!(Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    throw 'NVDA did not create its requested log file.'
  }
  $lines = Get-Content -LiteralPath $LogPath -Encoding UTF8
  # NVDA IO logging emits actual output as lines beginning with: Speaking [
  $speechEntries = @($lines | Where-Object { $_ -match 'Speaking \[' })
  if ($speechEntries.Count -lt 4) {
    throw "NVDA speech log contains only $($speechEntries.Count) Speaking entries; real speech output was not demonstrated."
  }
  $speech = $speechEntries -join "`n"
  $patterns = [ordered]@{
    title = 'WCAG\s+2\.2.*Audit Report|Audit Report'
    heading = 'Judgement summary|Evidence provenance|Claim boundary|Audit target|Requirement results|Contents'
    table = '\btable\b|Criterion|Result.*Count|row\s+[0-9]+|column\s+[0-9]+'
    link = 'Primary source|\blink\b'
  }
  $matchedRegions = @()
  foreach ($region in $patterns.Keys) {
    if ($speech -match $patterns[$region]) { $matchedRegions += $region }
  }
  $requiredRegions = @('title', 'heading', 'table')
  $missing = @($requiredRegions | Where-Object { $_ -notin $matchedRegions })
  if ($missing.Count -gt 0) {
    throw "NVDA speech output did not reach required report regions: $($missing -join ', ')."
  }
  return [ordered]@{
    entries = $speechEntries
    matched_regions = $matchedRegions
  }
}

$resolvedReport = (Resolve-Path -LiteralPath $ReportPath).Path
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$installerPath = Join-Path $outputRoot "nvda_$NvdaVersion.exe"
$portablePath = Join-Path $outputRoot 'nvda-portable'
$nvdaLogPath = Join-Path $outputRoot 'nvda.log'
$recordPath = Join-Path $outputRoot 'nvda-smoke-record.json'
$edgeProfile = Join-Path $outputRoot 'edge-profile'

foreach ($path in @($nvdaLogPath, $recordPath)) {
  if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite existing evidence file: $path" }
}

$edgeExecutable = Resolve-EdgeExecutable
$edgeStartedAt = Get-Date
$edgeProcess = $null
$nvdaExecutable = $null
$interactions = @()
try {
  Invoke-WebRequest -Uri $NvdaDownloadUrl -OutFile $installerPath -UseBasicParsing
  $actualInstallerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualInstallerHash -ne $NvdaSha256.ToLowerInvariant()) {
    throw "NVDA installer SHA-256 mismatch: expected $NvdaSha256, received $actualInstallerHash."
  }

  $portable = Start-Process -FilePath $installerPath -ArgumentList @(
    '--create-portable-silent',
    "--portable-path=$portablePath"
  ) -Wait -PassThru
  if ($portable.ExitCode -ne 0) {
    throw "NVDA portable creation failed with exit code $($portable.ExitCode)."
  }

  $nvdaExecutable = Join-Path $portablePath 'nvda.exe'
  if (!(Test-Path -LiteralPath $nvdaExecutable -PathType Leaf)) {
    throw 'The NVDA portable executable was not created.'
  }

  Start-Process -FilePath $nvdaExecutable -ArgumentList @(
    '--minimal',
    '--disable-addons',
    '--debug-logging',
    "--log-file=$nvdaLogPath",
    '--lang=en'
  ) | Out-Null
  Wait-NvdaRunning -NvdaExecutable $nvdaExecutable

  $reportUri = ([System.Uri]::new($resolvedReport)).AbsoluteUri
  $edgeStartedAt = Get-Date
  $edgeProcess = Start-Process -FilePath $edgeExecutable -ArgumentList @(
    "--user-data-dir=$edgeProfile",
    '--new-window',
    '--no-first-run',
    '--disable-extensions',
    '--disable-features=msEdgeFirstRunExperience',
    $reportUri
  ) -PassThru

  $shell = New-Object -ComObject WScript.Shell
  $null = Activate-ReportWindow -Shell $shell -StartedAt $edgeStartedAt
  Start-Sleep -Seconds 3
  $interactions = @(Send-SmokeGestures -Shell $shell)
  Start-Sleep -Seconds 3
}
finally {
  if ($nvdaExecutable -and (Test-Path -LiteralPath $nvdaExecutable -PathType Leaf)) {
    try {
      # Equivalent portable shutdown command: nvda.exe --quit
      Start-Process -FilePath $nvdaExecutable -ArgumentList @('--quit') -Wait -WindowStyle Hidden | Out-Null
    } catch {
      Write-Warning "NVDA shutdown command failed: $($_.Exception.Message)"
    }
  }
  try {
    Get-Process msedge -ErrorAction SilentlyContinue | Where-Object {
      try { $_.StartTime -ge $edgeStartedAt.AddSeconds(-2) } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Warning "Edge cleanup failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 2
}

$speechEvidence = Read-SpeechEvidence -LogPath $nvdaLogPath
$reportHash = (Get-FileHash -LiteralPath $resolvedReport -Algorithm SHA256).Hash.ToLowerInvariant()
$logHash = (Get-FileHash -LiteralPath $nvdaLogPath -Algorithm SHA256).Hash.ToLowerInvariant()
$record = [ordered]@{
  schema_version = '1.0.0'
  status = 'PASS'
  nvda = [ordered]@{
    version = $NvdaVersion
    download_url = $NvdaDownloadUrl
    installer_sha256 = $actualInstallerHash
    portable_executable = $nvdaExecutable
  }
  browser = [ordered]@{
    name = 'Microsoft Edge'
    executable = $edgeExecutable
  }
  report = [ordered]@{
    file = $resolvedReport
    sha256 = $reportHash
  }
  interactions = @($interactions | ForEach-Object { $_.name })
  speech_entry_count = $speechEvidence.entries.Count
  matched_regions = @($speechEvidence.matched_regions)
  speech_excerpt = @($speechEvidence.entries | Select-Object -First 20)
  nvda_log = [ordered]@{
    file = $nvdaLogPath
    sha256 = $logHash
  }
  limitations = @(
    'This is a bounded smoke test of one generated English fixture report on a GitHub-hosted Windows runner.',
    'It confirms that NVDA produced speech for selected major report regions; it is not a complete screen-reader usability study or a WCAG/JIS conformance assessment.',
    'Audio quality is not evaluated. Evidence is taken from NVDA own IO speech log, not from the accessibility tree or fixture source text.'
  )
}
[System.IO.File]::WriteAllText(
  $recordPath,
  (($record | ConvertTo-Json -Depth 10) + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output ($record | ConvertTo-Json -Depth 10 -Compress)
