function Join-SmokePath([string]$BasePath, [string]$ChildPath, [string]$Context) {
  if ([string]::IsNullOrWhiteSpace($BasePath)) {
    throw "Cannot resolve the $Context path because its base path is empty. Check the script directory, environment variables, and caller-supplied paths."
  }
  if ([string]::IsNullOrWhiteSpace($ChildPath)) {
    throw "Cannot resolve the $Context path because its child path is empty."
  }
  try {
    return [IO.Path]::GetFullPath((Join-Path -Path $BasePath -ChildPath $ChildPath -ErrorAction Stop))
  } catch {
    throw "Cannot resolve the $Context path from base '$BasePath' and child '$ChildPath': $($_.Exception.Message)"
  }
}

function Get-SmokeFullPath([string]$Path, [string]$Context) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Cannot resolve the $Context path because it is empty. Supply a non-empty path or omit the optional parameter."
  }
  try {
    return [IO.Path]::GetFullPath($Path)
  } catch {
    throw "Cannot resolve the $Context path '$Path': $($_.Exception.Message)"
  }
}

function Get-SmokeTempDirectory([string]$Context) {
  $runtimeTemp = [IO.Path]::GetTempPath()
  $candidates = @(
    @{ Source = '[IO.Path]::GetTempPath()'; Path = $runtimeTemp },
    @{ Source = 'TEMP'; Path = $env:TEMP },
    @{ Source = 'TMP'; Path = $env:TMP }
  )
  $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
    $candidates += @{ Source = 'LocalApplicationData\Temp'; Path = [IO.Path]::Combine($localAppData, 'Temp') }
  }
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate.Path) -or -not [IO.Path]::IsPathRooted($candidate.Path)) {
      continue
    }
    try {
      $fullPath = [IO.Path]::GetFullPath($candidate.Path)
      if (Test-Path -LiteralPath $fullPath -PathType Container) {
        return $fullPath
      }
    } catch {
      continue
    }
  }
  throw "No usable temporary directory is available for $Context. GetTempPath='$runtimeTemp', TEMP='$env:TEMP', TMP='$env:TMP', LocalApplicationData='$localAppData'."
}

function ConvertTo-SmokeVersionIdentity([string]$Version, [switch]$AllowZeroRevision, [string]$Context = 'Product') {
  if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "$Context version is empty or malformed."
  }
  $identifier = '(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
  $suffix = "(?<prerelease>-(?:$identifier)(?:\.(?:$identifier))*)?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
  $revision = if ($AllowZeroRevision) { '(?:\.(?<revision>\d+))?' } else { '' }
  $pattern = "^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$revision$suffix$"
  $match = [regex]::Match($Version, $pattern, [Text.RegularExpressions.RegexOptions]::CultureInvariant)
  if (-not $match.Success) {
    throw "$Context version '$Version' is malformed."
  }
  if ($match.Groups['revision'].Success -and $match.Groups['revision'].Value -cne '0') {
    throw "$Context version '$Version' has a nonzero Windows revision; only a zero revision is normalized."
  }
  return "$($match.Groups['major'].Value).$($match.Groups['minor'].Value).$($match.Groups['patch'].Value)$($match.Groups['prerelease'].Value)"
}

function Assert-SmokeProductVersion([string]$Expected, [string]$Actual, [string]$Context = 'Installed executable') {
  $expectedIdentity = ConvertTo-SmokeVersionIdentity $Expected -Context 'Expected'
  $actualIdentity = ConvertTo-SmokeVersionIdentity $Actual -AllowZeroRevision -Context 'Actual product'
  if ($actualIdentity -cne $expectedIdentity) {
    throw "$Context product version mismatch: expected '$Expected', got '$Actual'."
  }
}
