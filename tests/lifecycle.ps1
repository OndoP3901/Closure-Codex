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
    if ($key -eq 'Crt' -and $fixture.FailCrt) { throw 'Simulated launch failure' }
    $process = [pscustomobject]@{ HasExited = $false; ExitCode = 17; Disposed = $false }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
    return $process
}
$logs = [Collections.Generic.List[string]]::new()
$launches = [Collections.Generic.List[string]]::new()
$fixture = @{ FailCrt = $false }
$children = @{ Crt = $null; Pet = $null }
$recovery = @{
    Crt = @{ Attempts = 0; Started = 0; Due = 0 }
    Pet = @{ Attempts = 0; Started = 0; Due = 0 }
}

Update-Helpers $children $recovery 0
Assert-Test (($launches -join ',') -eq 'Crt,Pet') 'Both helpers must start.'
$crt = $children.Crt
$pet = $children.Pet
$crt.HasExited = $true
Update-Helpers $children $recovery 100
Assert-Test ($crt.Disposed -and !$children.Crt -and $children.Pet -eq $pet) 'Only the exited helper should be released.'
Update-Helpers $children $recovery 1099
Assert-Test ($launches.Count -eq 2) 'Retry delay should be respected.'
Update-Helpers $children $recovery 1100
Assert-Test ($children.Crt -and $children.Crt -ne $crt -and $children.Pet -eq $pet) 'CRT should restart independently.'
Update-Helpers $children $recovery 62000
Assert-Test ($recovery.Crt.Attempts -eq 0 -and $recovery.Pet.Attempts -eq 0) 'A stable run should reset the budget.'

$fixture.FailCrt = $true
$children.Crt.HasExited = $true
foreach ($at in 63000,64000,65000,66000,67000,68000,69000) {
    Update-Helpers $children $recovery $at
}
Assert-Test ($launches.Count -eq 7 -and $children.Pet -eq $pet) 'Repeated startup failures must stop at the retry limit.'
Assert-Test ($logs -contains 'Crt exited with code 17.') 'Record the process exit.'
Assert-Test (($logs -like '*reached its launch limit*').Count -eq 1) 'Record the retry limit once.'
$pet.ExitCode = 0
$pet.HasExited = $true
Update-Helpers $children $recovery 70000 @('Pet')
Update-Helpers $children $recovery 80000 @('Pet')
Assert-Test (!$children.Pet -and $launches.Count -eq 7) 'An intentional pet exit should stay closed regardless of Codex linkage.'
$recovery.Pet = @{ Attempts = 0; Started = 80000; Due = 0 }
Update-Helpers $children $recovery 80000 @('Pet')
$children.Pet.HasExited = $true
Update-Helpers $children $recovery 81000 @('Pet')
Update-Helpers $children $recovery 82000 @('Pet')
Assert-Test ($children.Pet -and $launches.Count -eq 9) 'An unexpected pet exit should recover without Codex.'

# Run the real watcher loop body against a simulated sequence of desktop events.
$loop = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.DoUntilStatementAst]
}, $true)
$bodyText = $loop.Body.Extent.Text
$tick = [scriptblock]::Create($bodyText.Substring(1, $bodyText.Length - 2))
function Test-CodexOpen { return $fixture.CodexOpen }
function Find-OpenHelpers { return @{ Crt = $fixture.LegacyCrt; Pet = $fixture.ManualPet } }
function Stop-Helpers($children, $keys) {
    foreach ($key in $keys) {
        $children[$key].Dispose()
        $children[$key] = $null
    }
}
$refreshSignal = [pscustomobject]@{ Pending = $false }
$refreshSignal | Add-Member -MemberType ScriptMethod -Name WaitOne -Value {
    $pending = $this.Pending
    $this.Pending = $false
    return $pending
}
$fixture = @{ FailCrt = $false; CodexOpen = $false; ManualPet = $null }
$clock = [pscustomobject]@{ ElapsedMilliseconds = 0 }
$children = @{ Crt = $null; Pet = $null }
$required = @{ Crt = $false; Pet = $false }
$recovery = @{}
$lastOpen = $null
$nextLegacyCheck = 0
$launches.Clear()
. $tick
Assert-Test ($children.Pet -and !$children.Crt -and ($launches -join ',') -eq 'Pet') 'Login without Codex must start the pet only.'
$desktopPet = $children.Pet
$fixture.CodexOpen = $true
$clock.ElapsedMilliseconds = 2000
. $tick
Assert-Test (!$children.Crt -and $children.Pet -eq $desktopPet -and $launches.Count -eq 1) 'Opening Codex must not launch the retired overlay.'
$fixture.CodexOpen = $false
$clock.ElapsedMilliseconds = 4000
. $tick
Assert-Test (!$children.Crt -and $children.Pet -eq $desktopPet) 'Closing Codex stops CRT and keeps the pet running.'
$desktopPet.HasExited = $true
$desktopPet.ExitCode = 0
$clock.ElapsedMilliseconds = 5000
. $tick
$clock.ElapsedMilliseconds = 6000
. $tick
Assert-Test (!$children.Pet -and $launches.Count -eq 1) 'An explicit pet exit remains closed across watcher ticks.'
$fixture.ManualPet = Start-Helper 'Pet'
$refreshSignal.Pending = $true
. $tick
Assert-Test ($children.Pet -eq $fixture.ManualPet) 'The watcher adopts a manually reopened pet.'
$children.Pet.HasExited = $true
$clock.ElapsedMilliseconds = 7000
. $tick
$clock.ElapsedMilliseconds = 8000
. $tick
Assert-Test ($children.Pet -and $children.Pet -ne $fixture.ManualPet) 'A manually reopened pet is protected by crash recovery.'
$protectedPet = $children.Pet
$fixture.LegacyCrt = [pscustomobject]@{ Disposed = $false }
$fixture.LegacyCrt | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
$clock.ElapsedMilliseconds = 12000
. $tick
Assert-Test ($fixture.LegacyCrt.Disposed -and !$children.Crt -and $children.Pet -eq $protectedPet) 'A leftover legacy overlay must be stopped without affecting the pet.'
'Lifecycle recovery passed.'
