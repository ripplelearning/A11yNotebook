<#
Requires an unlocked, interactive Windows desktop (not a service/session-0 runner).
Default profiles are created beneath Windows' temp path and removed on exit.
An explicitly supplied UserDataDirectory belongs to the caller and is retained.
Optional note round trips use the real renderer/UIA and app save command, not IPC,
DevTools, or an untouched filesystem sentinel.
#>
[CmdletBinding()]
param(
  [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\release\win-unpacked\A11y Notebook.exe'),
  [string]$ExpectedVersion,
  [string]$UserDataDirectory,
  [ValidateRange(5, 300)][int]$TimeoutSeconds = 60,
  [string]$LibraryDirectory,
  [string]$NoteName = 'upgrade-smoke.md',
  [string]$ExpectedNoteContent,
  [string]$ReplacementNoteContent
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This smoke test requires Windows UI Automation; it cannot run on Linux.'
}
if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) {
  throw 'Run on an unlocked interactive Windows desktop, not a service/session-0 runner.'
}
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Packaged application not found: $ExecutablePath. Run npm run package:win first."
}
$ExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ($ExpectedVersion) {
  $actualVersion = (Get-Item -LiteralPath $ExecutablePath).VersionInfo.ProductVersion
  if (($actualVersion -replace '\+.*$', '') -cne $ExpectedVersion) {
    throw "Product version mismatch: expected '$ExpectedVersion', got '$actualVersion'."
  }
  Write-Output "Verified executable product version: $actualVersion"
}
if ($LibraryDirectory -and -not $PSBoundParameters.ContainsKey('ExpectedNoteContent')) {
  throw 'LibraryDirectory requires ExpectedNoteContent for a real application read assertion.'
}
if ($NoteName -ne [IO.Path]::GetFileName($NoteName)) { throw 'NoteName must be a filename.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Wait-SmokeCondition([scriptblock]$Probe, [string]$Description) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastFailure = ''
  do {
    if ($script:appProcess.HasExited) { throw "Application exited before $Description (exit $($script:appProcess.ExitCode))." }
    try {
      $result = & $Probe
      if ($null -ne $result -and $result -ne $false) { return $result }
    } catch [System.Windows.Automation.ElementNotAvailableException] {
      $lastFailure = $_.Exception.Message
    } catch [System.InvalidOperationException] {
      $lastFailure = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for $Description. $lastFailure"
}

function Find-SmokeElement([string]$Name, $ControlType = $null) {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
  if ($null -ne $ControlType) {
    $condition = [System.Windows.Automation.AndCondition]::new($condition,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ControlType))
  }
  $script:window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Read-SmokeEditor($Editor) {
  $pattern = $null
  if ($Editor.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    return $pattern.Current.Value
  }
  if ($Editor.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    return $pattern.DocumentRange.GetText(-1)
  }
  throw 'Markdown source exposes neither UIA ValuePattern nor TextPattern.'
}

function ConvertTo-SmokeText([string]$Text) { $Text.Replace("`r`n", "`n").TrimEnd("`r", "`n") }

$ownsProfile = -not $UserDataDirectory
if ($ownsProfile) { $UserDataDirectory = Join-Path ([IO.Path]::GetTempPath()) "a11y-windows-ui-smoke-$([guid]::NewGuid().ToString('N'))" }
$UserDataDirectory = [IO.Path]::GetFullPath($UserDataDirectory)
if ($UserDataDirectory.Contains('"')) { throw 'Profile paths may not contain quotes.' }
$script:appProcess = $null
try {
  New-Item -ItemType Directory -Path $UserDataDirectory -Force | Out-Null
  # Start-Process joins argument arrays; quote the entire switch to preserve spaces.
  $script:appProcess = Start-Process -FilePath $ExecutablePath -ArgumentList @(
    "`"--user-data-dir=$UserDataDirectory`"", '--force-renderer-accessibility'
  ) -PassThru
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $script:appProcess.Id)
  $script:window = Wait-SmokeCondition {
    [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children, $condition)
  } 'the application window'

  foreach ($name in @('A11y Notebook', 'Main menu', 'Global search', 'Status bar')) {
    $null = Wait-SmokeCondition { Find-SmokeElement $name } "accessible element '$name'"
    Write-Output "Found accessible element: $name"
  }
  if ($LibraryDirectory) {
    # Verified in v1.1.1/src/renderer/features/vault/VaultTree.tsx: the prior
    # release predates the Library terminology. Do not accept its label on candidates.
    $treeName = if ($ExpectedVersion -ceq '1.1.1') { 'Vault files' } else { 'Library files' }
    $tree = Wait-SmokeCondition {
      Find-SmokeElement $treeName ([System.Windows.Automation.ControlType]::Tree)
    } "the restored library tree '$treeName'"
    $item = Wait-SmokeCondition {
      $items = $tree.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::TreeItem))
      foreach ($entry in $items) {
        if ($entry.Current.Name.Trim() -eq "$NoteName, note") { return $entry }
      }
    } "note '$NoteName' in the application library"
    $script:window.SetFocus()
    $item.SetFocus()
    if (-not $item.Current.HasKeyboardFocus) { throw 'Cannot focus the note; unlock the desktop.' }
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    # Opening the note is asynchronous. Wait for its tab before toggling edit mode.
    $null = Wait-SmokeCondition {
      $tabs = $script:window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::TabItem))
      foreach ($tab in $tabs) {
        if ($tab.Current.Name -eq [IO.Path]::GetFileNameWithoutExtension($NoteName)) { return $tab }
      }
    } 'the opened note tab'
    $script:window.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait('^e')
    $editor = Wait-SmokeCondition {
      Find-SmokeElement 'Markdown source' ([System.Windows.Automation.ControlType]::Edit)
    } 'the Markdown editor'
    $null = Wait-SmokeCondition {
      (ConvertTo-SmokeText (Read-SmokeEditor $editor)) -ceq (ConvertTo-SmokeText $ExpectedNoteContent)
    } 'the expected note content read through UI Automation'
    Write-Output 'Verified persisted note content through the application editor.'

    if ($PSBoundParameters.ContainsKey('ReplacementNoteContent')) {
      $pattern = $null
      if ($editor.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $pattern.SetValue($ReplacementNoteContent)
      } else {
        $editor.SetFocus()
        if (-not $editor.Current.HasKeyboardFocus) { throw 'Cannot focus the Markdown editor.' }
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        $escaped = [regex]::Replace($ReplacementNoteContent, '[+^%~(){}\[\]]', { param($match) '{' + $match.Value + '}' })
        [System.Windows.Forms.SendKeys]::SendWait($escaped)
      }
      $null = Wait-SmokeCondition {
        (ConvertTo-SmokeText (Read-SmokeEditor $editor)) -ceq (ConvertTo-SmokeText $ReplacementNoteContent)
      } 'the edited note content'
      $save = Wait-SmokeCondition { Find-SmokeElement 'Save note' } 'Save note'
      $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $notePath = Join-Path $LibraryDirectory $NoteName
      $null = Wait-SmokeCondition {
        (Test-Path -LiteralPath $notePath) -and
          (ConvertTo-SmokeText ([IO.File]::ReadAllText($notePath))) -ceq (ConvertTo-SmokeText $ReplacementNoteContent)
      } 'the application save to the disposable library'
      Write-Output 'Verified UI edit and application save to disk.'
    }
  }
  Write-Output 'PASS: real Windows desktop UI Automation smoke (not updater E2E).'
}
finally {
  if ($null -ne $script:appProcess) {
    if (-not $script:appProcess.HasExited) {
      $null = $script:appProcess.CloseMainWindow()
      if (-not $script:appProcess.WaitForExit(10000)) {
        & taskkill.exe /PID $script:appProcess.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and -not $script:appProcess.HasExited) { throw 'Failed to stop the smoke application process tree.' }
        $null = $script:appProcess.WaitForExit(10000)
      }
    }
    $script:appProcess.Dispose()
  }
  if ($ownsProfile -and (Test-Path -LiteralPath $UserDataDirectory)) {
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      try {
        Remove-Item -LiteralPath $UserDataDirectory -Recurse -Force
        break
      } catch {
        if ($attempt -eq 19) { throw }
        Start-Sleep -Milliseconds 500
      }
    }
  }
}
