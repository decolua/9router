# Full rebuild: stop, remove, build, and run
# Usage: .\rebuild.ps1

Write-Host "=== 9Router Full Rebuild ===" -ForegroundColor Cyan

Write-Host "`nStopping container..." -ForegroundColor Yellow
docker stop 9router 2>$null

Write-Host "Removing container..." -ForegroundColor Yellow
docker rm 9router 2>$null

Write-Host "Building image..." -ForegroundColor Yellow
docker build -t 9router .

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nRunning container..." -ForegroundColor Green
    docker run -d --name 9router -p 127.0.0.1:20128:20128 --env-file .env -v 9router-data:/app/data 9router
    
    Write-Host "`nContainer running. Showing logs..." -ForegroundColor Green
    docker logs -f 9router
} else {
    Write-Host "`nBuild failed! Check error above." -ForegroundColor Red
}
