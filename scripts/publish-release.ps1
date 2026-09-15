# Operator-only tool: builds the current PDA release zip and publishes it (uploads the zip +
# latest.json, records it in pda_releases) via the publish-release Edge Function, which uses
# upsert:true internally so re-publishing the same version safely overwrites. Run from this repo
# (alexzaxa-pda), not from the PDA app itself - this is a publishing tool, not something that
# ships to restaurant PCs.
#
# Requires: SUPABASE_ACCESS_TOKEN env var (a personal access token, not service_role) and the
# SEED_SETUP_KEY value that was set via `supabase secrets set` (see .seed-setup-key.local here).
param(
    [string]$PdaRoot = "F:\alexzaxa-solutions-pda-v3",
    [string]$ProjectRef = "fuzbuvmpfriprinypbaz",
    [string]$SetupKey = "",
    [string]$Notes = "",
    [Parameter(Mandatory=$true)][string]$SupabaseAnonKey
)
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SetupKey) {
    $KeyFile = Join-Path $RepoRoot ".seed-setup-key.local"
    if (Test-Path $KeyFile) { $SetupKey = (Get-Content $KeyFile -Raw).Trim() }
}
if (-not $SetupKey) { throw "No setup key available. Pass -SetupKey or ensure .seed-setup-key.local exists." }

Write-Host "Building release package from $PdaRoot..." -ForegroundColor Cyan
# No $LASTEXITCODE check here: make-release-package.ps1 is pure PowerShell (Compress-Archive,
# Get-FileHash) with no native executable at the end, so $LASTEXITCODE would just be whatever
# was left over from some earlier, unrelated command. $ErrorActionPreference='Stop' (set above)
# already makes any real failure inside it a terminating error that propagates up on its own,
# and the Test-Path check just below independently verifies the expected output exists.
& (Join-Path $PdaRoot "scripts\make-release-package.ps1")

$Version = (Get-Content (Join-Path $PdaRoot "VERSION.txt")).Trim()
$PackageName = "alexzaxa-pda-$Version.zip"
$PackagePath = Join-Path $PdaRoot "dist\$PackageName"
if (-not (Test-Path $PackagePath)) { throw "Expected package not found: $PackagePath" }
$Hash = (Get-FileHash -Path $PackagePath -Algorithm SHA256).Hash.ToLower()

Write-Host "Publishing $PackageName (sha256 $Hash)..." -ForegroundColor Cyan
$ZipBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($PackagePath))
$Body = @{ version = $Version; sha256 = $Hash; notes = $Notes; zip_base64 = $ZipBase64 } | ConvertTo-Json -Compress
$Response = Invoke-RestMethod -Method Post `
    -Uri "https://$ProjectRef.supabase.co/functions/v1/publish-release" `
    -Headers @{ "X-Setup-Key" = $SetupKey; "Authorization" = "Bearer $SupabaseAnonKey"; "apikey" = $SupabaseAnonKey; "Content-Type" = "application/json" } `
    -Body $Body
Write-Host ($Response | ConvertTo-Json)

Write-Host "`nPublished $Version." -ForegroundColor Green
Write-Host "Manifest: https://$ProjectRef.supabase.co/storage/v1/object/public/pda-releases/latest.json"
Write-Host "Package:  https://$ProjectRef.supabase.co/storage/v1/object/public/pda-releases/releases/$PackageName"
