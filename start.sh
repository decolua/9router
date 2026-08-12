docker stop 10router
docker rm 10router
docker build -t 10router .
# Volume name "9router-data" is retained for compatibility with existing installs — renaming it would orphan user data.
docker run -d --name 10router -p 20128:20128 --env-file .env -v 9router-data:/app/data 10router
