$ErrorActionPreference = 'Stop'
$watcher = Join-Path $PSScriptRoot '../outputs/closure-autostart/Watch-Codex.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($watcher, [ref] $tokens, [ref] $errors)
if ($errors.Count) { throw $errors[0].Message }
$update = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Update-Helpers'
}, $true)
. ([scriptblock]::Create($update.Extent.Text))

function Assert-Test($condition, $message) { if (!$condition) { throw $message } }
function Write-LifecycleLog($message) { $logs.Add($message) }
function Start-Helper($key) {
    $launches.Add($key)
    if ($key -eq 'Pet' -and $fixture.FailPet) { throw 'Simulated launch failure' }
    $process = [pscustomobject]@{ HasExited = $false; ExitCode = 17; Disposed = $false }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
    return $process
}
$logs = [Collections.Generic.List[string]]::new()
$launches = [Collections.Generic.List[string]]::new()
$fixture = @{ FailPet = $false }
$children = @{ Pet = $null }
$recovery = @{ Pet = @{ Attempts = 0; Started = 0; Due = 0 } }

Update-Helpers $children $recovery 0
Assert-Test (($launches -join ',') -eq 'Pet') 'The desktop pet must start.'
$pet = $children.Pet
$pet.HasExited = $true
Update-Helpers $children $recovery 100
Assert-Test ($pet.Disposed -and !$children.Pet) 'The exited pet should be released.'
Update-Helpers $children $recovery 1099
Assert-Test ($launches.Count -eq 1) 'Retry delay should be respected.'
Update-Helpers $children $recovery 1100
Assert-Test ($children.Pet -and $children.Pet -ne $pet) 'The pet should restart.'
Update-Helpers $children $recovery 62000
Assert-Test ($recovery.Pet.Attempts -eq 0) 'A stable run should reset the budget.'

$fixture.FailPet = $true
$children.Pet.HasExited = $true
foreach ($at in 63000,64000,65000,66000,67000,68000,69000) {
    Update-Helpers $children $recovery $at
}
Assert-Test ($launches.Count -eq 6 -and !$children.Pet) 'Repeated startup failures must stop at the retry limit.'
Assert-Test ($logs -contains 'Pet exited with code 17 while Codex was open.') 'Record the process exit.'
Assert-Test (($logs -like '*reached its launch limit*').Count -eq 1) 'Record the retry limit once.'

$fixture.FailPet = $false
$recovery.Pet = @{ Attempts = 0; Started = 0; Due = 0 }
Update-Helpers $children $recovery 70000 @('Pet') $true
$standalonePet = $children.Pet
Assert-Test ($standalonePet) 'The pet should start again after the retry budget resets.'
$standalonePet.ExitCode = 0
$standalonePet.HasExited = $true
Update-Helpers $children $recovery 80000 @('Pet') $true
Update-Helpers $children $recovery 90000 @('Pet') $true
Assert-Test (!$children.Pet -and $launches.Count -eq 7) 'An intentional standalone exit should stay closed.'
'Lifecycle recovery passed.'
