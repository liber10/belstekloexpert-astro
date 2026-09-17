$ErrorActionPreference = 'Stop'
$pluginRoot = Split-Path -Parent $PSScriptRoot
Push-Location $pluginRoot
try {
  npm.cmd run check
} finally {
  Pop-Location
}
