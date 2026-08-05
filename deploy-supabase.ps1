$ErrorActionPreference = "Stop"

$ProjectRef = "szwwpnbbsmjsbzzcecyj"
$SupabaseCli = Join-Path $env:APPDATA "npm\supabase.cmd"

if (-not (Test-Path -LiteralPath $SupabaseCli)) {
  throw "Supabase CLI tidak ditemukan di $SupabaseCli"
}

Write-Host "Mengaitkan repository ke project Supabase $ProjectRef..."
& $SupabaseCli link --project-ref $ProjectRef --yes
if ($LASTEXITCODE -ne 0) {
  throw "Gagal mengaitkan project Supabase dengan exit code $LASTEXITCODE."
}

Write-Host "Menerapkan seluruh migration database..."
& $SupabaseCli db push --linked --yes
if ($LASTEXITCODE -ne 0) {
  throw "Migration database gagal dengan exit code $LASTEXITCODE."
}

# Production allowlist. Fungsi runner, verifier, rebuild, dan payroll sekali pakai
# tidak boleh ditambahkan ke daftar ini. Fungsi sementara harus dinonaktifkan
# setelah pekerjaan selesai dan tidak menjadi bagian deployment reguler.
#
# Urutan penting:
# 1. AbsenCore menyediakan implementasi bisnis legacy yang dipanggil oleh Absen.
# 2. Absen menjadi gateway publik kompatibel untuk API aplikasi lama.
# 3. AbsenV2 membungkus operasi presensi sensitif dengan challenge dan idempotensi.
$FunctionNames = @(
  "AbsenCore",
  "Absen",
  "AbsenV2",
  "DeviceTrust",
  "SecurityOps",
  "ProductionReadiness",
  "AttendanceCorrections",
  "AttendanceImport",
  "OperationsV2",
  "WorkforceOps",
  "PlatformOps"
)

$TemporaryFunctionPattern = '^(RunP|RunPublish|VerifyPayroll|PublishPayroll\d|PublishPayrollFinal|RebuildPayroll|TrimPublished|PrepareLogo|CleanupOrphan|RunCleanup)'
$InvalidFunction = $FunctionNames | Where-Object { $_ -match $TemporaryFunctionPattern }
if ($InvalidFunction) {
  throw "Fungsi sementara tidak boleh berada di production allowlist: $($InvalidFunction -join ', ')"
}

foreach ($FunctionName in $FunctionNames) {
  $FunctionPath = Join-Path $PSScriptRoot "supabase\functions\$FunctionName"
  if (-not (Test-Path -LiteralPath $FunctionPath -PathType Container)) {
    throw "Source Edge Function tidak ditemukan: $FunctionPath"
  }

  Write-Host "Men-deploy Edge Function $FunctionName..."
  & $SupabaseCli functions deploy $FunctionName --project-ref $ProjectRef --no-verify-jwt --use-api --yes
  if ($LASTEXITCODE -ne 0) {
    throw "Deployment Edge Function $FunctionName gagal dengan exit code $LASTEXITCODE."
  }
}

Write-Host "Migration dan seluruh Edge Function production berhasil di-deploy ke $ProjectRef."
