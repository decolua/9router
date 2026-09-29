# 9Router tray icon for Windows using NotifyIcon
# IPC: stdin JSON commands, stdout JSON events
param([string]$IconPath, [string]$Tooltip)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class WinDpiAwareness {
  public static IntPtr PerMonitorAwareV2 { get { return new IntPtr(-4); } }
  public static IntPtr PerMonitorAware { get { return new IntPtr(-3); } }

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int value);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@

function Enable-HighDpiAwareness {
  $contexts = @(
    [WinDpiAwareness]::PerMonitorAwareV2,
    [WinDpiAwareness]::PerMonitorAware
  )

  foreach ($context in $contexts) {
    try {
      if ([WinDpiAwareness]::SetProcessDpiAwarenessContext($context)) { break }
    } catch {}
  }

  try { [WinDpiAwareness]::SetProcessDpiAwareness(2) | Out-Null } catch {}
  try { [WinDpiAwareness]::SetProcessDPIAware() | Out-Null } catch {}

  foreach ($context in $contexts) {
    try {
      $previous = [WinDpiAwareness]::SetThreadDpiAwarenessContext($context)
      if ($previous -ne [IntPtr]::Zero) { break }
    } catch {}
  }
}

Enable-HighDpiAwareness

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
$script:notifyIcon.Text = $Tooltip
$script:notifyIcon.Visible = $true

$script:menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:notifyIcon.ContextMenuStrip = $script:menu
$script:items = @()

function Write-Event($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

# Re-sync Token Saver labels whenever the user opens the menu
$script:menu.Add_Opening({
  Write-Event @{ type = "menu-open" }
})

function Add-MenuItem($index, $title, $enabled) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $title
  $item.Enabled = $enabled
  $idx = $index
  $item.Add_Click({ Write-Event @{ type = "click"; index = $idx } }.GetNewClosure())
  $script:menu.Items.Add($item) | Out-Null
  $script:items += $item
}

function Update-MenuItem($index, $title, $enabled) {
  if ($index -lt $script:items.Count) {
    $script:items[$index].Text = $title
    $script:items[$index].Enabled = $enabled
  }
}

function Set-Tooltip($text) {
  # NotifyIcon.Text max 63 chars
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $script:notifyIcon.Text = $text
}

function Process-CommandLine($line) {
  if ([string]::IsNullOrWhiteSpace($line)) { return }
  $cmd = $line | ConvertFrom-Json
  switch ($cmd.action) {
    "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled }
    "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled }
    "set-tooltip" { Set-Tooltip $cmd.text }
    "dump-items"  {
      $texts = @()
      foreach ($it in $script:items) { $texts += $it.Text }
      Write-Event @{ type = "dump"; items = $texts }
    }
    "ready"       { Write-Event @{ type = "ready" } }
    "kill"        {
      $script:notifyIcon.Visible = $false
      $script:notifyIcon.Dispose()
      [System.Windows.Forms.Application]::Exit()
    }
  }
}

Add-Type @"
using System;
using System.IO;
using System.Text;
using System.Collections.Concurrent;
using System.Threading;

public static class NineRouterStdinPump {
  public static void Start(ConcurrentQueue<string> queue) {
    var t = new Thread(() => {
      try {
        using (var input = Console.OpenStandardInput())
        using (var reader = new StreamReader(input, new UTF8Encoding(false), false, 1024, true)) {
          string line;
          while ((line = reader.ReadLine()) != null) {
            queue.Enqueue(line);
          }
        }
      } catch { }
    });
    t.IsBackground = true;
    t.Start();
  }
}
"@

# [Console]::In.Peek() is unreliable with redirected stdin on Windows — commands
# (update-item, kill, etc.) silently never arrive. Pump stdin on a .NET thread.
$script:inputQueue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
[NineRouterStdinPump]::Start($script:inputQueue)

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 50
$script:timer.Add_Tick({
  try {
    $line = $null
    while ($script:inputQueue.TryDequeue([ref]$line)) {
      Process-CommandLine $line
    }
  } catch {
    Write-Event @{ type = "error"; message = $_.Exception.Message }
  }
})
$script:timer.Start()

Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()
