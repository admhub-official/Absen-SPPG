$ErrorActionPreference = "Stop"

$ProjectRef = "szwwpnbbsmjsbzzcecyj"
$SupabaseCli = Join-Path $env:APPDATA "npm\supabase.cmd"

if (-not (Test-Path -LiteralPath $SupabaseCli)) {
  throw "Supabase CLI tidak ditemukan di $SupabaseCli"
}

& $SupabaseCli functions deploy Absen `
  --project-ref $ProjectRef `
  --no-verify-jwt `
  --use-api `
  --yes

if ($LASTEXITCODE -ne 0) {
  throw "Deployment Edge Function Absen gagal dengan exit code $LASTEXITCODE."
}

Write-Host "Edge Function Absen berhasil di-deploy ke $ProjectRef."
