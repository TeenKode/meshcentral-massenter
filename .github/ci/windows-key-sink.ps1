param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $false)]
    [string]$ReadyPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$fullLogPath = [System.IO.Path]::GetFullPath($LogPath)
[System.IO.File]::WriteAllText($fullLogPath, "")

# The official MeshCentral installer uses -fullinstall --copy-msh=1. The CI
# workflow currently calls -fullinstall only, so reproduce the missing copy
# before testing KVM. The source .msh was downloaded from this same test server.
try {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $sourceMsh = Join-Path $repoRoot '.ci-agent\meshagent.msh'
    $agentDir = Join-Path $env:ProgramFiles 'Mesh Agent'
    $targetMsh = Join-Path $agentDir 'MeshAgent.msh'

    if ((Test-Path $sourceMsh) -and (Test-Path $agentDir)) {
        Copy-Item -Path $sourceMsh -Destination $targetMsh -Force
        [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_COPIED`r`n")

        $raw = [System.IO.File]::ReadAllText($targetMsh)
        if ($raw -match '(?m)^MeshServer=local\r?$') {
            $patched = [regex]::Replace(
                $raw,
                '(?m)^MeshServer=local\r?$',
                'MeshServer=wss://localhost:4443/agent.ashx'
            )
            [System.IO.File]::WriteAllText($targetMsh, $patched, [System.Text.Encoding]::ASCII)
            [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_PATCHED`r`n")
        } else {
            [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_NO_SERVER_PATCH_NEEDED`r`n")
        }

        $svc = Get-Service | Where-Object {
            $_.DisplayName -like '*Mesh Agent*' -or $_.Name -like '*meshagent*'
        } | Select-Object -First 1
        if ($svc) {
            Restart-Service -Name $svc.Name -Force
            $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
            [System.IO.File]::AppendAllText($fullLogPath, "AGENT_SERVICE_RESTARTED`r`n")
        } else {
            [System.IO.File]::AppendAllText($fullLogPath, "AGENT_SERVICE_NOT_FOUND`r`n")
        }
    } else {
        [System.IO.File]::AppendAllText(
            $fullLogPath,
            ("AGENT_MSH_COPY_SOURCE_OR_TARGET_MISSING source={0} targetDir={1}`r`n" -f (Test-Path $sourceMsh), (Test-Path $agentDir))
        )
    }
} catch {
    [System.IO.File]::AppendAllText($fullLogPath, ("AGENT_MSH_SETUP_ERROR:{0}`r`n" -f $_.Exception.Message))
}

$fullReadyPath = $null
if ($ReadyPath) {
    $fullReadyPath = [System.IO.Path]::GetFullPath($ReadyPath)
    if (Test-Path $fullReadyPath) { Remove-Item $fullReadyPath -Force }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Mass Enter CI Key Sink'
$form.Width = 640
$form.Height = 300
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Dock = 'Top'
$label.Height = 40
$label.Text = 'This window records Enter key presses delivered through MeshCentral KVM.'
$form.Controls.Add($label)

$text = New-Object System.Windows.Forms.TextBox
$text.Dock = 'Fill'
$text.Multiline = $true
$text.AcceptsReturn = $true
$text.Text = 'Keyboard target is ready.'
$form.Controls.Add($text)

$text.Add_KeyDown({
    param($sender, $e)
    if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
        [System.IO.File]::AppendAllText($fullLogPath, "RETURN`r`n")
    } else {
        [System.IO.File]::AppendAllText($fullLogPath, ("KEY:{0}`r`n" -f $e.KeyCode))
    }
})

$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 1000
$focusTimer.Add_Tick({
    if ($form.Visible) {
        $form.Activate()
        $form.BringToFront()
        $text.Focus()
    }
})

$form.Add_Shown({
    $form.Activate()
    $form.BringToFront()
    $text.Focus()
    $focusTimer.Start()
    if ($fullReadyPath) {
        $pid = [System.Diagnostics.Process]::GetCurrentProcess().Id
        $hwnd = [System.Diagnostics.Process]::GetCurrentProcess().MainWindowHandle
        [System.IO.File]::WriteAllText($fullReadyPath, ("READY PID={0} HWND={1}" -f $pid, $hwnd))
    }
})

$form.Add_FormClosed({ $focusTimer.Stop() })
[System.Windows.Forms.Application]::Run($form)
