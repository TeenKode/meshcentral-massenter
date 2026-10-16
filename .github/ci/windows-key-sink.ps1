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

# MeshCentral starts in LAN mode in the CI harness. In that mode the generated
# agent settings use MeshServer=local, which relies on LAN discovery and does
# not work on a GitHub-hosted Windows runner. Keep the generated MeshID,
# certificate hash and all other settings intact; only point the CI agent at
# the already-running local MeshCentral server.
try {
    $agentDir = Join-Path $env:ProgramFiles 'Mesh Agent'
    $msh = Get-ChildItem -Path $agentDir -Filter '*.msh' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($msh) {
        $raw = [System.IO.File]::ReadAllText($msh.FullName)
        if ($raw -match '(?m)^MeshServer=local\r?$') {
            $patched = [regex]::Replace(
                $raw,
                '(?m)^MeshServer=local\r?$',
                'MeshServer=wss://localhost:4443/agent.ashx'
            )
            [System.IO.File]::WriteAllText($msh.FullName, $patched, [System.Text.Encoding]::ASCII)

            $svc = Get-Service | Where-Object {
                $_.DisplayName -like '*Mesh Agent*' -or $_.Name -like '*meshagent*'
            } | Select-Object -First 1
            if ($svc) {
                Restart-Service -Name $svc.Name -Force
                $svc.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(20))
                [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_PATCHED`r`n")
            } else {
                [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_PATCHED_NO_SERVICE`r`n")
            }
        } else {
            [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_NO_PATCH_NEEDED`r`n")
        }
    } else {
        [System.IO.File]::AppendAllText($fullLogPath, "AGENT_MSH_NOT_FOUND`r`n")
    }
} catch {
    [System.IO.File]::AppendAllText($fullLogPath, ("AGENT_MSH_PATCH_ERROR:{0}`r`n" -f $_.Exception.Message))
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
