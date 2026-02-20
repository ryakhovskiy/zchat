#!/bin/bash

# Pull the latest image
docker pull kryakhovskiy/zchat

# Run the container
# -d: Run in detached mode
# --rm: Remove the container when it exits
# -p 8000:8000: Map host port 8000 to container port 8000
# -v: Persist database and uploads
docker run -d --rm \
  -p 8000:8000 \
  -v $(pwd)/zchat.db:/app/zchat.db \
  -v $(pwd)/uploads:/app/uploads \
  --name zchat-backend \
  kryakhovskiy/zchat
