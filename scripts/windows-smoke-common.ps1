function ConvertTo-SmokeProductVersion([string]$Version) {
  # Windows may append a zero revision; build metadata does not affect identity.
  $pattern = '^(?<core>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\.0)?(?<prerelease>-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z'
  if ($Version -cnotmatch $pattern) { throw "Unsupported product version: '$Version'." }
  return $Matches['core'] + $Matches['prerelease']
}

function Test-SmokeProductVersion([string]$Actual, [string]$Expected) {
  return (ConvertTo-SmokeProductVersion $Actual) -ceq (ConvertTo-SmokeProductVersion $Expected)
}

function Resolve-SmokeExecutablePath([string]$ExecutablePath, [string]$ScriptRoot, [string]$ScriptPath) {
  if ([string]::IsNullOrEmpty($ExecutablePath)) {
    if ([string]::IsNullOrWhiteSpace($ScriptRoot)) {
      if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not [IO.Path]::IsPathRooted($ScriptPath)) {
        throw 'Cannot resolve the smoke script directory; supply an explicit ExecutablePath.'
      }
      $ScriptRoot = [IO.Path]::GetDirectoryName($ScriptPath)
    }
    if (-not [IO.Path]::IsPathRooted($ScriptRoot) -or -not (Test-Path -LiteralPath $ScriptRoot -PathType Container)) {
      throw "Invalid smoke script directory: '$ScriptRoot'."
    }
    $ExecutablePath = Join-Path $ScriptRoot '../release/win-unpacked/A11y Notebook.exe'
  }
  if ([string]::IsNullOrWhiteSpace($ExecutablePath) -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
    throw "Packaged application not found: '$ExecutablePath'. Run npm run package:win first."
  }
  return (Resolve-Path -LiteralPath $ExecutablePath).Path
}
