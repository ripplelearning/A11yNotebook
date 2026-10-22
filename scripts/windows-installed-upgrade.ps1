<#
Installer-over-install smoke, NOT electron-updater/download/signature E2E.
Use a disposable Windows user/VM with an unlocked desktop: NSIS writes normal
per-user uninstall registration and shortcuts even with a disposable /D path.
No signing, certificate, publisher, or updater policy is bypassed or modified.

Example (GH_TOKEN needs read access to the public release API):
  pwsh -File scripts/windows-installed-upgrade.ps1 `
    -CandidateInstallerPath release/A11y-Notebook-Setup-1.1.2.exe -CandidateVersion 1.1.2

We seed a real Markdown library and the existing recent-vault.json shape to
avoid locale-dependent native folder pickers. The prior app must read this note
through UIA, edit it and save it; the candidate must read that saved text through
UIA, then edit/save again. This tests one unencrypted Markdown note and reopening
a recent library, not all metadata, encrypted libraries, or automatic migrations.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CandidateInstallerPath,
  [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')][string]$CandidateVersion,
  [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$PriorInstallerSha256,
  [ValidateRange(30, 900)][int]$InstallerTimeoutSeconds = 180,
  [ValidateRange(5, 300)][int]$UiTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$scriptDirectory = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptDirectory) -and -not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
  $scriptDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($PSCommandPath))
}
if ([string]::IsNullOrWhiteSpace($scriptDirectory)) {
  throw 'Cannot resolve the installed-upgrade script directory. PSScriptRoot and PSCommandPath are empty; run the .ps1 file with -File or invoke its path instead of pasting or evaluating its contents inline.'
}
$commonScript = [IO.Path]::Combine($scriptDirectory, 'windows-smoke-common.ps1')
if (-not (Test-Path -LiteralPath $commonScript -PathType Leaf)) {
  throw "Windows smoke helpers not found at '$commonScript'. Run the checked-out script together with its scripts directory."
}
. $commonScript
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'The installed-upgrade smoke requires a real Windows interactive desktop.'
}
if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) {
  throw 'Use an unlocked desktop in a disposable Windows user/VM, not session 0.'
}
$null = ConvertTo-SmokeVersionIdentity $CandidateVersion -Context 'Candidate'
if ([version]($CandidateVersion -split '-', 2)[0] -le [version]'1.1.1') {
  throw 'CandidateVersion must be newer than stable 1.1.1.'
}
if ([string]::IsNullOrWhiteSpace($CandidateInstallerPath)) {
  throw 'CandidateInstallerPath is empty. Supply a verified installer file path.'
}
$CandidateInstallerPath = (Resolve-Path -LiteralPath $CandidateInstallerPath).Path
if (-not (Test-Path -LiteralPath $CandidateInstallerPath -PathType Leaf)) { throw 'Candidate installer must be a file.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install/authenticate GitHub CLI (gh) before running this script.' }

# /D alone does not isolate NSIS's product registration. Refuse to risk another
# installed copy or existing shortcuts; this is intentionally not a developer-PC test.
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($registryRoot in $uninstallRoots) {
  if (Test-Path -LiteralPath $registryRoot) {
    $existing = Get-ChildItem -LiteralPath $registryRoot | Get-ItemProperty |
      Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like '*A11y Notebook*' }
    if ($existing) { throw 'An A11y Notebook install already exists. Use a clean disposable Windows user/VM.' }
  }
}
foreach ($folder in @('DesktopDirectory', 'CommonDesktopDirectory', 'Programs', 'CommonPrograms')) {
  $base = [Environment]::GetFolderPath([Environment+SpecialFolder]$folder)
  if (-not [string]::IsNullOrWhiteSpace($base) -and (Test-Path -LiteralPath (Join-SmokePath $base 'A11y Notebook.lnk' 'shortcut'))) {
    throw 'Existing A11y Notebook shortcuts found. Use a clean disposable Windows user/VM.'
  }
}
if (Get-CimInstance Win32_Process -Filter "Name = 'A11y Notebook.exe'") {
  throw 'Close existing A11y Notebook processes before running in a disposable account.'
}

function Invoke-SmokeInstaller([string]$Path, [string]$Arguments, [int]$TimeoutSeconds) {
  $installer = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
  try {
    if (-not $installer.WaitForExit($TimeoutSeconds * 1000)) {
      & taskkill.exe /PID $installer.Id /T /F | Out-Null
      throw "Installer timed out: $Path"
    }
    if ($installer.ExitCode -ne 0) { throw "Installer failed with exit code $($installer.ExitCode): $Path" }
  } finally {
    $installer.Dispose()
  }
}

function Assert-SmokeInstalledVersion([string]$Expected) {
  if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "Installed executable missing: $installedExe"
  }
  $actual = (Get-Item -LiteralPath $installedExe).VersionInfo.ProductVersion
  Assert-SmokeProductVersion $Expected $actual 'Installed executable'
  Write-Output "Verified installed executable product version: $actual"
}

function Get-SmokePriorDigest($Asset, [string]$PinnedHash) {
  $digest = ''
  if ($Asset.PSObject.Properties['digest']) { $digest = [string]$Asset.digest }
  if ($digest -match '^sha256:([0-9a-fA-F]{64})$') {
    $expectedHash = $Matches[1]
    if ($PinnedHash -and $PinnedHash -ine $expectedHash) {
      throw 'Pinned prior installer SHA-256 disagrees with GitHub release asset digest.'
    }
    return $expectedHash
  }
  if ($PinnedHash) {
    Write-Information 'GitHub asset digest unavailable; using explicitly pinned prior installer SHA-256.' -InformationAction Continue
    return $PinnedHash
  }
  throw 'No SHA-256 asset digest available. Supply -PriorInstallerSha256 from a trusted source; unverified installers are not run.'
}

# Runtime artifacts belong to the disposable Windows account, never the checkout.
$workRoot = Join-SmokePath (Get-SmokeTempDirectory 'installed-upgrade workspace') "a11y-windows-installed-upgrade-$([guid]::NewGuid().ToString('N'))" 'installed-upgrade workspace'
$installDirectory = Join-SmokePath $workRoot 'install' 'installation'
$profileDirectory = Join-SmokePath $workRoot 'profile' 'profile'
$library = Join-SmokePath $workRoot 'library' 'library'
$downloads = Join-SmokePath $workRoot 'downloads' 'downloads'
$installedExe = Join-SmokePath $installDirectory 'A11y Notebook.exe' 'installed executable'
$installationAttempted = $false
$cleanupSucceeded = $false
try {
  New-Item -ItemType Directory -Path $downloads, $profileDirectory, $library -Force | Out-Null
  $releaseJson = & gh api 'repos/ripplelearning/A11yNotebook/releases/tags/v1.1.1'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read stable release metadata. Set GH_TOKEN with release read access.' }
  $release = ($releaseJson -join "`n") | ConvertFrom-Json
  if ($release.tag_name -ne 'v1.1.1' -or $release.draft -or $release.prerelease) {
    throw 'Expected the published stable v1.1.1 release.'
  }
  $assetName = 'A11y-Notebook-Setup-1.1.1.exe'
  $assets = @($release.assets | Where-Object { $_.name -ceq $assetName })
  if ($assets.Count -ne 1) { throw "Expected exactly one stable installer asset '$assetName'." }
  $expectedHash = Get-SmokePriorDigest $assets[0] $PriorInstallerSha256
  & gh release download v1.1.1 --repo ripplelearning/A11yNotebook --pattern $assetName --dir $downloads
  if ($LASTEXITCODE -ne 0) { throw 'Stable installer download failed.' }
  $priorInstaller = Join-SmokePath $downloads $assetName 'prior installer'
  if ((Get-FileHash -LiteralPath $priorInstaller -Algorithm SHA256).Hash -ine $expectedHash) {
    throw 'Stable installer SHA-256 mismatch; refusing execution.'
  }
  Write-Output 'Verified stable v1.1.1 installer SHA-256.'
  Write-Output 'Scope: manual NSIS install-over-install; no automatic updater or signing-policy E2E.'

  $noteName = 'upgrade-smoke.md'
  $initial = 'UIA upgrade fixture ' + [guid]::NewGuid().ToString('N')
  $priorSaved = 'Saved by stable 1.1.1 through the actual UI ' + [guid]::NewGuid().ToString('N')
  $candidateSaved = 'Saved by candidate through the actual UI ' + [guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText((Join-SmokePath $library $noteName 'smoke note'), $initial)
  [IO.File]::WriteAllText((Join-SmokePath $profileDirectory 'recent-vault.json' 'recent library profile'), (@{ lastOpened = $library } | ConvertTo-Json))

  $installationAttempted = $true
  # NSIS requires /D last, without embedded quotes, even when the path has spaces.
  Invoke-SmokeInstaller $priorInstaller "/S /D=$installDirectory" $InstallerTimeoutSeconds
  Assert-SmokeInstalledVersion '1.1.1'
  $smokeScript = Join-SmokePath $scriptDirectory 'windows-ui-automation-smoke.ps1' 'UI smoke script'
  $smokeArguments = @{
    ExecutablePath = $installedExe
    UserDataDirectory = $profileDirectory
    LibraryDirectory = $library
    NoteName = $noteName
    TimeoutSeconds = $UiTimeoutSeconds
  }
  & $smokeScript @smokeArguments -ExpectedVersion '1.1.1' -ExpectedNoteContent $initial -ReplacementNoteContent $priorSaved
  # Deliberately do not uninstall or rewrite the profile/library between versions.
  Invoke-SmokeInstaller $CandidateInstallerPath "/S /D=$installDirectory" $InstallerTimeoutSeconds
  Assert-SmokeInstalledVersion $CandidateVersion
  & $smokeScript @smokeArguments -ExpectedVersion $CandidateVersion -ExpectedNoteContent $priorSaved -ReplacementNoteContent $candidateSaved
  # A further real app restart proves the candidate's save can be read back.
  & $smokeScript @smokeArguments -ExpectedVersion $CandidateVersion -ExpectedNoteContent $candidateSaved
  Write-Output "PASS: installed 1.1.1 -> $CandidateVersion; UI-verified Markdown read/edit/save persistence."
}
finally {
  try {
    if ($installationAttempted) {
      # Only processes under our unique installation directory may be terminated.
      foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'A11y Notebook.exe'")) {
        if ($process.ExecutablePath -and $process.ExecutablePath.StartsWith(
            $installDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
          & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
        }
      }
      $uninstaller = Join-SmokePath $installDirectory 'Uninstall A11y Notebook.exe' 'uninstaller'
      if (Test-Path -LiteralPath $uninstaller) {
        # _?= avoids a copied, asynchronous uninstaller so its completion is awaited.
        Invoke-SmokeInstaller $uninstaller "/S _?=$installDirectory" $InstallerTimeoutSeconds
      } else {
        throw "No uninstaller found after installation attempt. Inspect $workRoot and discard the disposable VM/account."
      }
    }
    if (Test-Path -LiteralPath $workRoot) {
      for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
          Remove-Item -LiteralPath $workRoot -Recurse -Force
          break
        } catch {
          if ($attempt -eq 19) { throw }
          Start-Sleep -Milliseconds 500
        }
      }
    }
    $cleanupSucceeded = $true
  } finally {
    if (-not $cleanupSucceeded) { Write-Warning "Cleanup incomplete: $workRoot. Discard the disposable Windows VM/account." }
  }
}
