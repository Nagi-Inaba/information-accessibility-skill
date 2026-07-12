[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$codexSkill = Join-Path $root 'codex\skills\information-accessibility-practice'
$claudeSkill = Join-Path $root 'claude\skills\information-accessibility-practice'
$errors = [System.Collections.Generic.List[string]]::new()

function Get-RelativeFiles {
    param([string]$BasePath)
    Get-ChildItem -LiteralPath $BasePath -Recurse -File |
        ForEach-Object { $_.FullName.Substring($BasePath.Length + 1) } |
        Where-Object { $_ -ne 'agents\openai.yaml' } |
        Sort-Object
}

function Normalize-Text {
    param([string]$Text)
    ($Text -replace "`r`n", "`n").Trim()
}

$codexFiles = @(Get-RelativeFiles -BasePath $codexSkill)
$claudeFiles = @(Get-RelativeFiles -BasePath $claudeSkill)

$missingFromClaude = @($codexFiles | Where-Object { $_ -notin $claudeFiles })
$missingFromCodex = @($claudeFiles | Where-Object { $_ -notin $codexFiles })
foreach ($file in $missingFromClaude) { $errors.Add("Missing from Claude skill: $file") }
foreach ($file in $missingFromCodex) { $errors.Add("Missing from Codex skill: $file") }

$commonFiles = @($codexFiles | Where-Object { $_ -in $claudeFiles })
foreach ($relativePath in $commonFiles) {
    $codexPath = Join-Path $codexSkill $relativePath
    $claudePath = Join-Path $claudeSkill $relativePath
    $codexHash = (Get-FileHash -LiteralPath $codexPath -Algorithm SHA256).Hash
    $claudeHash = (Get-FileHash -LiteralPath $claudePath -Algorithm SHA256).Hash
    if ($codexHash -ne $claudeHash) {
        $errors.Add("Content mismatch: $relativePath")
    }
}

$jsonFiles = Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.json'
foreach ($jsonFile in $jsonFiles) {
    try {
        Get-Content -LiteralPath $jsonFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null
    } catch {
        $errors.Add("Invalid JSON: $($jsonFile.FullName) - $($_.Exception.Message)")
    }
}

$codexAgentPath = Join-Path $root 'codex\agents\information-accessibility-reviewer.toml'
$claudeAgentPath = Join-Path $root 'claude\agents\information-accessibility-reviewer.md'
$codexAgent = Get-Content -LiteralPath $codexAgentPath -Raw -Encoding UTF8
$claudeAgent = Get-Content -LiteralPath $claudeAgentPath -Raw -Encoding UTF8
$codexMatch = [regex]::Match($codexAgent, 'developer_instructions = """\r?\n(?<body>[\s\S]*?)\r?\n"""')
$claudeMatch = [regex]::Match($claudeAgent, '\A---\r?\n[\s\S]*?\r?\n---\r?\n(?<body>[\s\S]*)\z')
if (-not $codexMatch.Success) {
    $errors.Add('Could not extract Codex developer_instructions.')
} elseif (-not $claudeMatch.Success) {
    $errors.Add('Could not extract Claude agent body.')
} elseif ((Normalize-Text $codexMatch.Groups['body'].Value) -ne (Normalize-Text $claudeMatch.Groups['body'].Value)) {
    $errors.Add('Codex and Claude agent instruction bodies differ.')
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

[pscustomobject]@{
    SharedSkillFiles = $commonFiles.Count
    JsonFilesParsed = $jsonFiles.Count
    AgentBodiesEqual = $true
    Status = 'PASS'
} | Format-List
