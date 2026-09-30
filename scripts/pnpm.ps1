# Uses an installed pnpm, or the bundled Codex runtime when it is available.
# Example: .\scripts\pnpm.ps1 dev
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
Push-Location -LiteralPath $taskRoot
try {
  if ($taskPnpm) {
    & $taskPnpm.Source @args
  } else {
    $taskNode = (Get-Command node -ErrorAction Stop).Source
    $taskNodeDirectory = Split-Path -Parent $taskNode
    $taskCandidates = @(
      (Join-Path $taskNodeDirectory 'node_modules\pnpm\bin\pnpm.cjs'),
      (Join-Path (Split-Path -Parent $taskNodeDirectory) 'node_modules\pnpm\bin\pnpm.cjs')
    )
    $taskCli = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $taskCli) { throw 'Instale pnpm 11.19.0 e execute este comando novamente.' }
    & $taskNode $taskCli @args
  }
  $taskExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $taskExitCode
