docker stop zcus-9router
docker rm zcus-9router
docker build -t zcus-9router .
docker run -d --name zcus-9router -p 20129:20129 --env-file .env -v 9router-data:/app/data zcus-9router