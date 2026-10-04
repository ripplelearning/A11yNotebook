param(
  [string]$ExecutablePath = (Join-Path $PSScriptRoot '..\release\win-unpacked\A11y Notebook.exe')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ExecutablePath)) {
  throw "Packaged application not found: $ExecutablePath. Run npm run package:win first."
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$process = Start-Process -FilePath $ExecutablePath -PassThru
try {
  $deadline = (Get-Date).AddSeconds(30)
  $window = $null
  $processCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    $process.Id
  )
  while ((Get-Date) -lt $deadline -and -not $window) {
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
      [System.Windows.Automation.TreeScope]::Children,
      $processCondition
    )
    if (-not $window) { Start-Sleep -Milliseconds 250 }
  }
  if (-not $window) { throw 'The application window did not appear in UI Automation.' }

  foreach ($name in @('A11y Notebook', 'Main menu', 'Global search', 'Status bar')) {
    $nameCondition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $nameCondition)
    if (-not $element) { throw "UI Automation could not find the accessible element '$name'." }
    Write-Output "Found accessible element: $name"
  }
}
finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
