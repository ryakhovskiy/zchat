#!/bin/bash

# Define image tag
IMAGE_TAG="kryakhovskiy/zchat"

# Build the Docker image
echo "Building Docker image: $IMAGE_TAG"
docker build -t $IMAGE_TAG .

# Push the Docker image to the registry
echo "Pushing Docker image: $IMAGE_TAG"
docker push $IMAGE_TAG

echo "Done."
