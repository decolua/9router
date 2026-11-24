# Stop the 9router container
# Usage: .\stop.ps1

Write-Host "Stopping 9router container..." -ForegroundColor Yellow

$containerExists = docker ps -a --filter "name=9router" --quiet
if ($containerExists) {
    docker stop 9router
    Write-Host "Container stopped." -ForegroundColor Green
} else {
    Write-Host "Container not found." -ForegroundColor Gray
}
