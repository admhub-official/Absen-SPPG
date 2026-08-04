$ErrorActionPreference = "Stop"

$ProjectRef = "szwwpnbbsmjsbzzcecyj"
$SupabaseCli = Join-Path $env:APPDATA "npm\supabase.cmd"

if (-not (Test-Path -LiteralPath $SupabaseCli)) { throw "Supabase CLI tidak ditemukan di $SupabaseCli" }

Write-Host "Mengaitkan repository ke project Supabase $ProjectRef..."
& $SupabaseCli link --project-ref $ProjectRef --yes
if ($LASTEXITCODE -ne 0) { throw "Gagal mengaitkan project Supabase dengan exit code $LASTEXITCODE." }

Write-Host "Menerapkan seluruh migration database..."
& $SupabaseCli db push --linked --yes
if ($LASTEXITCODE -ne 0) { throw "Migration database gagal dengan exit code $LASTEXITCODE." }

# Urutan penting:
# 1. AbsenCore menyediakan implementasi bisnis legacy yang dipanggil oleh Absen.
# 2. Absen menjadi gateway publik kompatibel untuk API aplikasi lama.
# 3. AbsenV2 membungkus operasi presensi sensitif dengan challenge, rate limit, dan idempotensi.
$FunctionNames = @(
  "AbsenCore",
  "Absen",
  "AbsenV2",
  "DeviceTrust",
  "SecurityOps",
  "ProductionReadiness",
  "AttendanceCorrections",
  "OperationsV2",
  "WorkforceOps",
  "PlatformOps"
)

foreach ($FunctionName in $FunctionNames) {
  Write-Host "Men-deploy Edge Function $FunctionName..."
  & $SupabaseCli functions deploy $FunctionName --project-ref $ProjectRef --no-verify-jwt --use-api --yes
  if ($LASTEXITCODE -ne 0) { throw "Deployment Edge Function $FunctionName gagal dengan exit code $LASTEXITCODE." }
}

Write-Host "Migration dan seluruh Edge Function berhasil di-deploy ke $ProjectRef."
