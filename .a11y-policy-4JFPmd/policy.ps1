$ErrorActionPreference = 'Stop'
$validation = Get-Content release/desktop-validation.json -Raw | ConvertFrom-Json
if (!$validation.publicationAllowed) {
  throw 'Desktop publication policy failed: stable requires passing checks or an explicit dispatch exception; skipped/cancelled/unknown outcomes are never eligible.'
}

