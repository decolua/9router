# Start or restart the 9router container
# Usage: .\start.ps1

Write-Host "Starting 9router container..." -ForegroundColor Green

$containerExists = docker ps -a --filter "name=9router" --quiet
if ($containerExists) {
    Write-Host "Container exists. Restarting..." -ForegroundColor Yellow
    docker start 9router
} else {
    Write-Host "Container not found. Running new container..." -ForegroundColor Yellow
    docker run -d --name 9router -p 127.0.0.1:20128:20128 --env-file .env -v 9router-data:/app/data 9router
}

Write-Host "`nContainer started. Showing logs..." -ForegroundColor Green
docker logs -f 9router
