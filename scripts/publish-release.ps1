# Operator-only tool: builds the current PDA release zip, uploads it plus a fresh latest.json
# to the public pda-releases Supabase Storage bucket, and records it in pda_releases (changelog).
# Run from this repo (alexzaxa-pda), not from the PDA app itself - this is a publishing tool,
# not something that ships to restaurant PCs.
#
# Requires: SUPABASE_ACCESS_TOKEN env var (a personal access token, not service_role) and the
# SEED_SETUP_KEY value that was set via `supabase secrets set` (see .seed-setup-key.local here).
param(
    [string]$PdaRoot = "F:\alexzaxa-solutions-pda-v3",
    [string]$ProjectRef = "fuzbuvmpfriprinypbaz",
    [string]$SetupKey = "",
    [Parameter(Mandatory=$true)][string]$SupabaseAnonKey
)
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SetupKey) {
    $KeyFile = Join-Path $RepoRoot ".seed-setup-key.local"
    if (Test-Path $KeyFile) { $SetupKey = (Get-Content $KeyFile -Raw).Trim() }
}
if (-not $SetupKey) { throw "No setup key available. Pass -SetupKey or ensure .seed-setup-key.local exists." }
if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "Set `$env:SUPABASE_ACCESS_TOKEN to a Supabase personal access token first." }

Write-Host "Building release package from $PdaRoot..." -ForegroundColor Cyan
& (Join-Path $PdaRoot "scripts\make-release-package.ps1")
if ($LASTEXITCODE -ne 0) { throw "make-release-package.ps1 failed." }

$Version = (Get-Content (Join-Path $PdaRoot "VERSION.txt")).Trim()
$PackageName = "alexzaxa-pda-$Version.zip"
$PackagePath = Join-Path $PdaRoot "dist\$PackageName"
if (-not (Test-Path $PackagePath)) { throw "Expected package not found: $PackagePath" }
$Hash = (Get-FileHash -Path $PackagePath -Algorithm SHA256).Hash.ToLower()

Write-Host "Uploading $PackageName (sha256 $Hash)..." -ForegroundColor Cyan
npx --yes supabase@latest storage cp $PackagePath "ss:///pda-releases/releases/$PackageName" `
    --linked --project-ref $ProjectRef --experimental --content-type "application/zip"
if ($LASTEXITCODE -ne 0) { throw "Upload of the release zip failed." }

$StoragePath = "releases/$PackageName"
$DownloadUrl = "https://$ProjectRef.supabase.co/storage/v1/object/public/pda-releases/$StoragePath"

$Manifest = @{ version = $Version; url = $DownloadUrl; sha256 = $Hash } | ConvertTo-Json -Compress
$ManifestFile = Join-Path ([System.IO.Path]::GetTempPath()) "latest.json"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ManifestFile, $Manifest, $Utf8NoBom)

Write-Host "Publishing latest.json..." -ForegroundColor Cyan
npx --yes supabase@latest storage cp $ManifestFile "ss:///pda-releases/latest.json" `
    --linked --project-ref $ProjectRef --experimental --content-type "application/json"
if ($LASTEXITCODE -ne 0) { throw "Upload of latest.json failed." }
Remove-Item $ManifestFile -Force -ErrorAction SilentlyContinue

Write-Host "Recording release in pda_releases..." -ForegroundColor Cyan
$Body = @{ version = $Version; sha256 = $Hash; storage_path = $StoragePath } | ConvertTo-Json
$Response = Invoke-RestMethod -Method Post `
    -Uri "https://$ProjectRef.supabase.co/functions/v1/publish-release" `
    -Headers @{ "X-Setup-Key" = $SetupKey; "Authorization" = "Bearer $SupabaseAnonKey"; "apikey" = $SupabaseAnonKey; "Content-Type" = "application/json" } `
    -Body $Body
Write-Host ($Response | ConvertTo-Json)

Write-Host "`nPublished $Version." -ForegroundColor Green
Write-Host "Manifest: https://$ProjectRef.supabase.co/storage/v1/object/public/pda-releases/latest.json"
Write-Host "Package:  $DownloadUrl"
