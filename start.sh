docker stop 8router
docker rm 8router
docker build -t 8router .
docker run -d --name 8router -p 20128:20128 --env-file .env -v 8router-data:/app/data 8router