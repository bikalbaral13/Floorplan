# Floorplan - local server launcher (opened by "Start Floorplan.bat").
# A small window: choose a port (default 2500), Run, copy the URL. Stop or
# closing the window shuts the server down.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:TEMP 'floorplan-dev-server.log'
$script:proc = $null
$script:seen = 0

# ---- window ---------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Floorplan - local server'
$form.Size = New-Object System.Drawing.Size(620, 470)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MinimumSize = New-Object System.Drawing.Size(520, 380)

$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = 'Port'
$lblPort.Location = New-Object System.Drawing.Point(16, 20)
$lblPort.AutoSize = $true

$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Text = '2500'
$txtPort.Location = New-Object System.Drawing.Point(60, 16)
$txtPort.Width = 80

$btnRun = New-Object System.Windows.Forms.Button
$btnRun.Text = 'Run'
$btnRun.Location = New-Object System.Drawing.Point(152, 14)
$btnRun.Size = New-Object System.Drawing.Size(90, 30)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = 'Stop'
$btnStop.Location = New-Object System.Drawing.Point(250, 14)
$btnStop.Size = New-Object System.Drawing.Size(90, 30)
$btnStop.Enabled = $false

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = 'Not running'
$lblStatus.Location = New-Object System.Drawing.Point(352, 20)
$lblStatus.AutoSize = $true
$lblStatus.ForeColor = [System.Drawing.Color]::Gray

$lblUrl = New-Object System.Windows.Forms.Label
$lblUrl.Text = 'URL'
$lblUrl.Location = New-Object System.Drawing.Point(16, 64)
$lblUrl.AutoSize = $true

$txtUrl = New-Object System.Windows.Forms.TextBox
$txtUrl.ReadOnly = $true
$txtUrl.Location = New-Object System.Drawing.Point(60, 60)
$txtUrl.Width = 380
$txtUrl.Anchor = 'Top, Left, Right'

$btnCopy = New-Object System.Windows.Forms.Button
$btnCopy.Text = 'Copy'
$btnCopy.Location = New-Object System.Drawing.Point(450, 58)
$btnCopy.Size = New-Object System.Drawing.Size(70, 30)
$btnCopy.Anchor = 'Top, Right'
$btnCopy.Enabled = $false

$btnOpen = New-Object System.Windows.Forms.Button
$btnOpen.Text = 'Open'
$btnOpen.Location = New-Object System.Drawing.Point(526, 58)
$btnOpen.Size = New-Object System.Drawing.Size(70, 30)
$btnOpen.Anchor = 'Top, Right'
$btnOpen.Enabled = $false

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = 'Vertical'
$txtLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$txtLog.Location = New-Object System.Drawing.Point(16, 102)
$txtLog.Size = New-Object System.Drawing.Size(580, 316)
$txtLog.Anchor = 'Top, Bottom, Left, Right'

$form.Controls.AddRange(@($lblPort, $txtPort, $btnRun, $btnStop, $lblStatus, $lblUrl, $txtUrl, $btnCopy, $btnOpen, $txtLog))
$form.AcceptButton = $btnRun

# ---- helpers ----------------------------------------------------------------
function Set-Status($text, $color) {
  $lblStatus.Text = $text
  $lblStatus.ForeColor = $color
}

function Stop-Server {
  if ($script:proc -and -not $script:proc.HasExited) {
    # Kill the whole tree: cmd -> npm -> node (vite).
    & taskkill.exe /PID $script:proc.Id /T /F | Out-Null
  }
  $script:proc = $null
  $btnRun.Enabled = $true
  $btnStop.Enabled = $false
  $txtPort.Enabled = $true
  $btnCopy.Enabled = $false
  $btnOpen.Enabled = $false
  Set-Status 'Stopped' ([System.Drawing.Color]::Gray)
}

# Poll the server's log: show it, and pick up the URL once Vite prints it.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  if (Test-Path $log) {
    $text = Get-Content $log -Raw -ErrorAction SilentlyContinue
    if ($text -and $text.Length -ne $script:seen) {
      $script:seen = $text.Length
      # Drop terminal colour codes.
      $clean = $text -replace "$([char]27)\[[0-9;]*m", ''
      $txtLog.Text = $clean
      $txtLog.SelectionStart = $txtLog.Text.Length
      $txtLog.ScrollToCaret()
      if (-not $txtUrl.Text) {
        $m = [regex]::Match($clean, 'Local:\s+(http://\S+)')
        if ($m.Success) {
          $txtUrl.Text = $m.Groups[1].Value
          $btnCopy.Enabled = $true
          $btnOpen.Enabled = $true
          Set-Status 'Running' ([System.Drawing.Color]::SeaGreen)
        }
      }
      if ($clean -match 'Port \d+ is already in use|EADDRINUSE') {
        Set-Status 'Port already in use' ([System.Drawing.Color]::Firebrick)
      }
    }
  }
  if ($script:proc -and $script:proc.HasExited) {
    $script:proc = $null
    $btnRun.Enabled = $true
    $btnStop.Enabled = $false
    $txtPort.Enabled = $true
    if ($lblStatus.Text -eq 'Running' -or $lblStatus.Text -like 'Starting*') { Set-Status 'Server exited' ([System.Drawing.Color]::Firebrick) }
  }
})
$timer.Start()

# ---- buttons ----------------------------------------------------------------
$btnRun.Add_Click({
  $port = 0
  if (-not [int]::TryParse($txtPort.Text.Trim(), [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    [System.Windows.Forms.MessageBox]::Show('Enter a port number between 1 and 65535.', 'Floorplan') | Out-Null
    return
  }
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    [System.Windows.Forms.MessageBox]::Show("Port $port is already in use. Choose another port, or stop whatever is using it.", 'Floorplan') | Out-Null
    return
  }
  if (-not (Test-Path (Join-Path $repo 'node_modules'))) {
    [System.Windows.Forms.MessageBox]::Show("node_modules is missing. Open a terminal in`n$repo`nand run: npm install", 'Floorplan') | Out-Null
    return
  }
  Remove-Item $log -ErrorAction SilentlyContinue
  $script:seen = 0
  $txtUrl.Text = ''
  $txtLog.Text = ''
  $btnRun.Enabled = $false
  $btnStop.Enabled = $true
  $txtPort.Enabled = $false
  Set-Status "Starting on port $port..." ([System.Drawing.Color]::DarkGoldenrod)
  # --port overrides the 3000 in vite.config.ts; output goes to the log the timer reads.
  $script:proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList "/c npm run dev -- --port $port --strictPort > `"$log`" 2>&1" `
    -WorkingDirectory $repo -WindowStyle Hidden -PassThru
})

$btnStop.Add_Click({ Stop-Server })

$btnCopy.Add_Click({
  if ($txtUrl.Text) {
    [System.Windows.Forms.Clipboard]::SetText($txtUrl.Text)
    Set-Status 'URL copied' ([System.Drawing.Color]::SeaGreen)
  }
})

$btnOpen.Add_Click({ if ($txtUrl.Text) { Start-Process $txtUrl.Text } })

$form.Add_FormClosing({
  $timer.Stop()
  Stop-Server
})

[void]$form.ShowDialog()
