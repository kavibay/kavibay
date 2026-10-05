# Run on Windows after Tauri has downloaded NSIS: ./src-tauri/windows/hooks.assert.ps1
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/Bin/makensis.exe'
$scratch = Join-Path (Resolve-Path "$PSScriptRoot/../target").Path "uninstall-check-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $scratch | Out-Null

# Run the real hook against an isolated profile, never the user's $PROFILE.
$hook = (Get-Content "$PSScriptRoot/hooks.nsh" -Raw).Replace('$PROFILE', '$TestProfile')
$header = @'
Unicode true
!include LogicLib.nsh
!define VERSION "test"
Name "Kavibay uninstall data check"
OutFile "check.exe"
RequestExecutionLevel user
SilentInstall silent
Var DeleteAppDataCheckboxState
Var UpdateMode
Var TestProfile
'@
$cases = @'
Section
'@
foreach ($case in @(@(1, 0, $false), @(0, 0, $true), @(1, 1, $true))) {
    $profile = Join-Path $scratch "profile-$($case[0])-$($case[1])"
    $cases += "`nStrCpy `$TestProfile `"$profile`"`n"
    $cases += "CreateDirectory `"`$TestProfile\.kavibay`"`n"
    $cases += "FileOpen `$0 `"`$TestProfile\.kavibay\settings.json`" w`nFileWrite `$0 saved`nFileClose `$0`n"
    $cases += "StrCpy `$DeleteAppDataCheckboxState $($case[0])`nStrCpy `$UpdateMode $($case[1])`n"
    $cases += '!insertmacro NSIS_HOOK_POSTUNINSTALL' + "`n"
    $cases += '${If' + $(if ($case[2]) { 'Not' } else { '' }) + '} ${FileExists} "$TestProfile\.kavibay\settings.json"' + "`n"
    $cases += "SetErrorLevel 1`nQuit`n" + '${EndIf}' + "`n"
}
$cases += 'SectionEnd'
Set-Content -LiteralPath "$scratch/check.nsi" -Value "$header`n$hook`n$cases" -Encoding utf8
Push-Location $scratch
try {
    & $compiler /V2 check.nsi
    if ($LASTEXITCODE -ne 0) { throw 'NSIS compile failed' }
    $process = Start-Process -FilePath "$scratch/check.exe" -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw 'Uninstall data check failed' }
} finally {
    Pop-Location
}
Write-Output 'hooks.assert.ps1: ok (delete selected; preserve unchecked and updates)'
