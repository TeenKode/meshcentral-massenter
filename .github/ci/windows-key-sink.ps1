param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$fullLogPath = [System.IO.Path]::GetFullPath($LogPath)
[System.IO.File]::WriteAllText($fullLogPath, "")

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
})

$form.Add_FormClosed({ $focusTimer.Stop() })
[System.Windows.Forms.Application]::Run($form)
