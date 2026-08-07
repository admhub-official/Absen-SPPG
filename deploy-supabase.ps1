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

$ObsoleteFunctions = @(
  "AbsenLegacy","AbsenProxy","BulkPublishPayroll","RebuildPayroll100","PrepareLogoBGN","PublishPayroll100Logo","TrimPublishedTo100","PublishPayroll50Logo","PublishPayroll200Once","PublishPayroll2000Once","PublishPayroll100Direct","PublishPayroll100DirectV2","PublishPayroll100DirectV3","PublishPayrollNext100","PublishPayroll550","PublishPayroll650","PublishPayroll750","PublishPayroll850","RunPublishPayroll850","RunP850B1x7k2","RunP850B2q9m4","VerifyPayroll850PDF","PublishPayroll950","RunP950B1","RunP950B2","VerifyPayroll950PDF","PublishPayroll1050","RunP1050B1","RunP1050B2","VerifyPayroll1050PDF","PublishPayroll1150","RunP1150B1","VerifyPayroll1150PDF","PublishPayroll1250","RunP1250","VerifyPayroll1250PDF","PublishPayroll1350","RunP1350","VerifyPayroll1350PDF","PublishPayroll1450","RunP1450","VerifyPayroll1450PDF","PublishPayroll1550","RunP1550","VerifyPayroll1550PDF","PublishPayroll1650","RunP1650","VerifyPayroll1650PDF","PublishPayroll1750","RunP1750","VerifyPayroll1750PDF","PublishPayrollFinal1897","RunPFinal1897","RunPFinal1897B2","RunPFinal1897B3","VerifyPayrollFinal1897PDF","CleanupOrphanPayrollPDFs","RunCleanupOrphanPayrollPDFs","PayrollTTDMassal","SyncPayrollSignatureLogo","PendingSignatureCounts","DigitalIdentityPrint","ResetDigitalIdentityOnce"
)
foreach ($FunctionName in $ObsoleteFunctions) {
  Write-Host "Menghapus Edge Function lama $FunctionName..."
  & $SupabaseCli functions delete $FunctionName --project-ref $ProjectRef --yes
  if ($LASTEXITCODE -ne 0) { Write-Warning "Fungsi $FunctionName tidak ditemukan atau sudah dihapus." }
}

# Endpoint yang memang harus dapat dipanggil browser secara langsung. Masing-masing
# memiliki autentikasi/validasi sendiri atau menyediakan operasi verifikasi publik.
$PublicFunctionNames = @(
  "SessionGateway","Complaints","DigitalIdentity","OperationsV2","WorkforceOps","PlatformOps"
)

# Implementasi internal hanya dipanggil antar Edge Function memakai service-role JWT.
$InternalFunctionNames = @(
  "AbsenCore","Absen",
  "AbsenV2Core","AttendanceLocationCore","PayrollUserCore","ProfileOpsCore","DeviceTrustCore",
  "SecurityOpsCore","ProductionReadinessCore","AttendanceCorrectionsCore","AttendanceImportCore","EmploymentContractsCore"
)

$TemporaryFunctionPattern = '^(RunP|RunPublish|VerifyPayroll|PublishPayroll\d|PublishPayrollFinal|RebuildPayroll|TrimPublished|PrepareLogo|CleanupOrphan|RunCleanup|ResetDigitalIdentity)'
$InvalidFunction = @($PublicFunctionNames + $InternalFunctionNames) | Where-Object { $_ -match $TemporaryFunctionPattern }
if ($InvalidFunction) { throw "Fungsi sementara tidak boleh berada di production allowlist: $($InvalidFunction -join ', ')" }

foreach ($FunctionName in $PublicFunctionNames) {
  $FunctionPath = Join-Path $PSScriptRoot "supabase\functions\$FunctionName"
  if (-not (Test-Path -LiteralPath $FunctionPath -PathType Container)) { throw "Source Edge Function tidak ditemukan: $FunctionPath" }
  Write-Host "Men-deploy Edge Function publik $FunctionName..."
  & $SupabaseCli functions deploy $FunctionName --project-ref $ProjectRef --no-verify-jwt --use-api --yes
  if ($LASTEXITCODE -ne 0) { throw "Deployment Edge Function $FunctionName gagal dengan exit code $LASTEXITCODE." }
}

foreach ($FunctionName in $InternalFunctionNames) {
  $FunctionPath = Join-Path $PSScriptRoot "supabase\functions\$FunctionName"
  if (-not (Test-Path -LiteralPath $FunctionPath -PathType Container)) { throw "Source Edge Function tidak ditemukan: $FunctionPath" }
  Write-Host "Men-deploy Edge Function internal $FunctionName dengan JWT verification..."
  & $SupabaseCli functions deploy $FunctionName --project-ref $ProjectRef --use-api --yes
  if ($LASTEXITCODE -ne 0) { throw "Deployment Edge Function internal $FunctionName gagal dengan exit code $LASTEXITCODE." }
}

# Compatibility aliases: perangkat dengan cache frontend lama masih memanggil nama
# function historis. Deploy source SessionGateway ke nama-nama tersebut sehingga raw
# bearer token diubah ke digest sebelum masuk ke *Core. Source asli selalu dipulihkan
# di working tree setelah deploy agar repository tidak dimutasi permanen.
$GatewayAliases = @(
  "AbsenV2","AttendanceLocation","PayrollUser","ProfileOps","DeviceTrust",
  "SecurityOps","ProductionReadiness","AttendanceCorrections","AttendanceImport","EmploymentContracts"
)
$GatewaySourcePath = Join-Path $PSScriptRoot "supabase\functions\SessionGateway\index.ts"
$GatewaySource = Get-Content -LiteralPath $GatewaySourcePath -Raw
foreach ($AliasName in $GatewayAliases) {
  $AliasIndex = Join-Path $PSScriptRoot "supabase\functions\$AliasName\index.ts"
  if (-not (Test-Path -LiteralPath $AliasIndex -PathType Leaf)) { throw "Source alias tidak ditemukan: $AliasIndex" }
  $OriginalSource = Get-Content -LiteralPath $AliasIndex -Raw
  try {
    Set-Content -LiteralPath $AliasIndex -Value $GatewaySource -NoNewline -Encoding UTF8
    Write-Host "Men-deploy compatibility gateway pada endpoint $AliasName..."
    & $SupabaseCli functions deploy $AliasName --project-ref $ProjectRef --no-verify-jwt --use-api --yes
    if ($LASTEXITCODE -ne 0) { throw "Deployment compatibility gateway $AliasName gagal dengan exit code $LASTEXITCODE." }
  }
  finally {
    Set-Content -LiteralPath $AliasIndex -Value $OriginalSource -NoNewline -Encoding UTF8
  }
}

Write-Host "Migration, pembersihan fungsi lama, gateway sesi, dan deployment production selesai untuk $ProjectRef."
