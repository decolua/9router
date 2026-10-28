docker stop 9router
docker rm 9router
docker build -t 9router .
docker run -d --name 9router -p 127.0.0.1:20128 --env-file .env -v 9router-data:/app/data 9router