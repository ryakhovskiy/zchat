# Use an official Node runtime as a parent image
FROM node:18-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application code
COPY . .

# Environment variables for build time
# Defaults match standard proxy setup, can be overridden via --build-arg
ARG VITE_API_URL=/api
ARG VITE_WS_URL=/ws
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Build the application
RUN npm run build

# Install 'serve' to run the application
RUN npm install -g serve

# The application runs on port 3000
EXPOSE 3000

# Serve the 'dist' directory on port 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
