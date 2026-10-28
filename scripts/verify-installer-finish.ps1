param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$Installation, [Parameter(Mandatory=$true)][string]$Receipt, [switch]$Attach)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'This interactive installer check requires an isolated Windows release runner.' }
$reviewRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
foreach ($reviewPath in @($Installer, $Installation, $Receipt)) {
    if (-not [IO.Path]::GetFullPath($reviewPath).StartsWith($reviewRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer review path is outside the runner temporary directory.' }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Path (Join-Path $PSScriptRoot 'installer-controls.cs')
$process = $null
if ($Attach) {
    $attachDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not $process -and [DateTime]::UtcNow -lt $attachDeadline) {
        $matches = @(Get-Process | Where-Object { $_.Path -eq $Installer })
        if ($matches.Count -gt 1) { throw 'Ambiguous installer process.' }
        if ($matches.Count -eq 1) { $process = $matches[0] } else { Start-Sleep -Milliseconds 200 }
    }
    if (-not $process) { throw 'The updater did not start its verified installer.' }
} else { $process = [Diagnostics.Process]::Start($Installer, '/currentuser /D=' + $Installation) }
# Keep the attached process handle alive so its exit status remains available.
$null = $process.Handle
$deadline = [DateTime]::UtcNow.AddSeconds(180)
$finishVerified = $false
$observed = @()
try {
    while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
        $window = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $process.Id))
        if ($null -eq $window) { Start-Sleep -Milliseconds 200; continue }
        $elements = $window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        $launch = $null; $shortcut = $null; $finish = $null; $next = $null
        $observed = @()
        foreach ($element in $elements) {
            $label = $element.Current.Name.Replace('&', '').Trim()
            $handle = $element.Current.NativeWindowHandle
            $nativeClass = if ($handle) { [InstallerControls]::ClassName($handle) } else { '' }
            $observed += @{label=$label; nativeClass=$nativeClass; enabled=$element.Current.IsEnabled}
            if ($label -eq 'Open OpenGEO') { $launch = $element }
            if ($label -eq 'Create a desktop shortcut') { $shortcut = $element }
            if ($nativeClass -eq 'Button' -and $element.Current.IsEnabled) {
                if ($label -eq 'Finish') { $finish = $element }
                if ($label -in @('Next >', 'Next', 'Install')) { $next = $element }
            }
        }
        if ($finish -and $launch -and $shortcut) {
            $launchHandle = $launch.Current.NativeWindowHandle
            $shortcutHandle = $shortcut.Current.NativeWindowHandle
            if ([InstallerControls]::CheckState($launchHandle) -ne 0) { [InstallerControls]::Click($launchHandle) }
            if ([InstallerControls]::CheckState($shortcutHandle) -ne 1) { [InstallerControls]::Click($shortcutHandle) }
            $toggleDeadline = [DateTime]::UtcNow.AddSeconds(5)
            while (([InstallerControls]::CheckState($launchHandle) -ne 0 -or [InstallerControls]::CheckState($shortcutHandle) -ne 1) -and [DateTime]::UtcNow -lt $toggleDeadline) { Start-Sleep -Milliseconds 50 }
            if ([InstallerControls]::CheckState($launchHandle) -ne 0 -or [InstallerControls]::CheckState($shortcutHandle) -ne 1) { throw 'Finish checkboxes did not retain independent selections.' }
            [InstallerControls]::Click($finish.Current.NativeWindowHandle)
            $finishVerified = $true
            break
        }
        if ($next) { [InstallerControls]::Click($next.Current.NativeWindowHandle) }
        Start-Sleep -Milliseconds 200
    }
    if (-not $finishVerified -or -not $process.WaitForExit(30000) -or $process.ExitCode -ne 0) { throw 'The actual installer finish screen did not complete successfully.' }
    $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'OpenGEO.lnk'
    if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Selected desktop shortcut was not created.' }
    $shell = New-Object -ComObject WScript.Shell
    $target = $shell.CreateShortcut($desktopLink).TargetPath
    if ([IO.Path]::GetFullPath($target) -ne [IO.Path]::GetFullPath((Join-Path $Installation 'OpenGEO.exe'))) { throw 'Shortcut points to a different installation.' }
    @{finishScreen=$true; launchCheckbox=$true; shortcutCheckbox=$true; shortcutTargetVerified=$true; installerExit=$process.ExitCode} | ConvertTo-Json | Set-Content -LiteralPath $Receipt -Encoding utf8
} finally {
    @{finishObserved=$finishVerified; controls=$observed} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ($Receipt + '.diagnostic.json') -Encoding utf8
    if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
}
