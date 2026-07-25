$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\9Router.lnk")
$Shortcut.TargetPath = "cmd.exe"
$Shortcut.Arguments = '/c cd /d "C:\Users\Dmitry\Yandex.Disk\САЙТЫ\9router-russian" && start-with-recovery.bat'
$Shortcut.WorkingDirectory = "C:\Users\Dmitry\Yandex.Disk\САЙТЫ\9router-russian"
$Shortcut.Description = "Запуск 9Router"
$Shortcut.WindowStyle = 1
$Shortcut.Save()
Write-Host "Ярлык создан на рабочем столе"