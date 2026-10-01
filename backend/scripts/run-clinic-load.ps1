param(
  [Parameter(Mandatory=$true)][string]$TestDatabaseUrl,
  [string]$ReportPath = (Join-Path $PWD 'clinic-load-report.json')
)
$ErrorActionPreference = 'Stop'
$target = [Uri]$TestDatabaseUrl
if ($target.Scheme -notin @('postgresql','postgres') -or $target.Host -notin @('localhost','127.0.0.1','[::1]') -or $target.AbsolutePath -ne '/medbook_load_test') {
  throw 'Only a loopback PostgreSQL database named medbook_load_test is allowed.'
}
$names = @('RUN_CLINIC_LOAD','TEST_DATABASE_URL','DATABASE_URL','CLINIC_LOAD_REPORT')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
  $env:RUN_CLINIC_LOAD = '1'
  $env:TEST_DATABASE_URL = $TestDatabaseUrl
  $env:DATABASE_URL = $TestDatabaseUrl
  $env:CLINIC_LOAD_REPORT = [IO.Path]::GetFullPath($ReportPath)
  Push-Location (Join-Path $PSScriptRoot '..')
  try {
    & npm.cmd test -- --run clinicDay.load --reporter=dot
    if ($LASTEXITCODE -ne 0) { throw 'Clinic load test failed. Inspect the test output and JSON report.' }
  } finally { Pop-Location }
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
}
