# Web Application Deployment Guide

Complete guide for deploying a web application (frontend + backend) to an Ubuntu server with a custom domain.

## Table of Contents
1. [Server Setup](#server-setup)
2. [User Configuration](#user-configuration)
3. [SSH Key Setup](#ssh-key-setup)
4. [Domain Configuration](#domain-configuration)
5. [SSL Certificate Setup](#ssl-certificate-setup)
6. [Nginx Configuration](#nginx-configuration)
7. [Backend Deployment (Docker)](#backend-deployment-docker)
8. [Frontend Deployment (Vite)](#frontend-deployment-vite)
9. [Final Testing](#final-testing)

---

### Docker Deployment Check

Ensure your `docker-compose.yml` has the correct port mappings and volume definitions:

```yaml
  frontend:
    build:
      context: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
  backend_uploads:
```

### Nginx Configuration

Ensure your `frontend/nginx.conf` handles client-side routing and listens on port 3000:

```nginx
server {
    listen 3000;
    
    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
```

## 1. Server Setup

### Install Nginx
```bash
sudo apt update
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Configure Firewall (if UFW is enabled)
```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

---

## 2. User Configuration

### Create Non-Root User
Instead of using root, create a dedicated user `kr`:

```bash
# As root user
adduser kr

# Add to sudo group
usermod -aG sudo kr

#Change password
passwd kr

# Switch to new user
su - kr
```

---

## 3. SSH Key Setup

### On Your Local Computer

Generate a new SSH key pair:

```bash
ssh-keygen -t ed25519 -C "kr@server-ip"
```

Follow the prompts

### Copy Public Key to Server

```bash
# On local machine - copy your public key
cat ~/.ssh/id_ed25519.pub
```

Then on the server (as root):
```bash
mkdir -p /home/kr/.ssh
vi /home/kr/.ssh/authorized_keys
# Paste the public key, save and exit

# Set proper permissions
chown -R kr:kr /home/kr/.ssh
chmod 700 /home/kr/.ssh
chmod 600 /home/kr/.ssh/authorized_keys
```

### Test SSH Connection
```bash
ssh kr@server-ip
```

### Create SSH Config (Local Machine)
Edit `~/.ssh/config`:
```
Host myserver
    HostName server-ip
    User kr
    IdentityFile ~/.ssh/id_ed25519
```

Then connect with: `ssh myserver`

---

## 4. Domain Configuration

### Purchase Domain
Use any domain registrar (Namecheap)

Domain: `zchat.space`

### Configure DNS Records

In your domain registrar's DNS management panel, add:

**A Record for root domain:**
```
Type: A
Host: @
Value: server-ip-address
TTL: Automatic 
```

**A Record for www subdomain:**
```
Type: A
Host: www
Value: server-ip-address
TTL: Automatic
```

**Wait for DNS propagation** 

Test DNS propagation:
```bash
dig zchat.space
dig www.zchat.space
```

---

## 5. SSL Certificate Setup

### Install Certbot (Let's Encrypt)
```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

### Create Website Directory
```bash
sudo mkdir -p /var/www/zchat.space
sudo chown -R $USER:$USER /var/www/zchat.space
sudo chmod -R 755 /var/www/zchat.space
```

### Create Temporary Index Page
```bash
echo "<h1>zchat.space - Coming Soon</h1>" > /var/www/zchat.space/index.html
```

### Create Basic Nginx Config (Temporary - HTTP Only)
```bash
sudo vi /etc/nginx/sites-available/zchat.space
```

Add:
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name zchat.space www.zchat.space;
    
    root /var/www/zchat.space;
    index index.html;
    
    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Enable the Site
```bash
# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Enable your site
sudo ln -s /etc/nginx/sites-available/zchat.space /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Obtain SSL Certificate
```bash
sudo certbot --nginx -d zchat.space -d www.zchat.space
```

Follow the prompts:
- Enter email address
- Agree to terms
- Certbot will automatically configure HTTPS

---

## 6. Nginx Configuration

### Final Nginx Configuration with Redirects

```bash
sudo vi /etc/nginx/sites-available/zchat.space
```

Replace with:
```nginx
# Redirect IP access to domain name (HTTP)
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 301 https://zchat.space$request_uri;
}

# Redirect IP access to domain name (HTTPS)
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    
    ssl_certificate /etc/letsencrypt/live/zchat.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zchat.space/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    
    return 301 https://zchat.space$request_uri;
}

# Redirect HTTP to HTTPS for domain
server {
    listen 80;
    listen [::]:80;
    server_name zchat.space www.zchat.space;
    return 301 https://$host$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name zchat.space www.zchat.space;
    
    # Proxy everything to Frontend Container
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    ssl_certificate /etc/letsencrypt/live/zchat.space/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/zchat.space/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}
```

### Test and Reload
```bash
sudo nginx -t
sudo systemctl reload nginx
```

**What this configuration does:**
- `http://server-ip` → `https://zchat.space`
- `https://server-ip` → `https://zchat.space`
- `http://zchat.space` → `https://zchat.space`
- `http://www.zchat.space` → `https://www.zchat.space`
- Proxies all requests to the Frontend Docker container on port 3000 (which handles API routing)

---

## 7. Backend Deployment (Docker)

### Install Docker (if not already installed)
```bash
sudo apt update
sudo apt install docker.io docker-compose -y
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
```

### Prepare Project Structure

Clone your repository to `~/zchat`:
```bash
git clone <your-repo-url> ~/zchat
cd ~/zchat
```

**Directory structure:**
```
~/zchat/
├── docker-compose.yml
├── deployment.md
├── backend/
│   ├── Dockerfile
│   ├── .env
│   └── ... 
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── ...
└── postgres/
    └── Dockerfile
```

### Configure Environment Variables

Create `.env` file for your backend:
```bash
vi backend/.env
```

**CORS:** Update CORS origins to include your domain:
```env
# Backend configuration
PORT=8000

# CORS - Allow your domain
CORS_ORIGINS=["https://zchat.space", "https://www.zchat.space"]

# Database and other configs...
DATABASE_URL=postgresql://user:password@db:5432/dbname

# WebSocket configuration (if applicable)
WS_PORT=8000
```

### docker-compose.yml
Update your `docker-compose.yml` to include all services (Postgres, Backend, Frontend). The frontend now runs in a container with its own internal Nginx.

```yaml
version: '3.8'

services:
  postgres:
    build: 
      context: ./postgres
    environment:
      POSTGRES_DB: zchat
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: 
      context: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/zchat
      SECRET_KEY: change_me_in_production
      ALGORITHM: HS256
      ACCESS_TOKEN_EXPIRE_MINUTES: 30
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - backend_uploads:/app/uploads
    command: sh -c "python app/db_init.py && uvicorn app.main:app --host 0.0.0.0 --port 8000"

  frontend:
    build:
      context: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
  backend_uploads:
```

### Deploy
```bash
cd ~/zchat
docker-compose up -d --build
```

### Verify Services
```bash
docker-compose ps
# You should see frontend (3000->8000), backend (8000->8000), and postgres (5432->5432)
```

---

## 8. Frontend Deployment (Docker)

The frontend is now deployed as a Docker container. 

### Internal Nginx Configuration (`frontend/nginx.conf`)
The frontend container uses an internal Nginx to serve the React app and proxy API requests to the backend container. Create `frontend/nginx.conf` with the following content:

```nginx
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_min_length 1000;
    gzip_proxied expired no-cache no-store private auth;
    gzip_types text/plain text/css application/json application/javascript application/x-javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to the backend
    location /api {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Proxy WebSocket requests
    location /ws {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

### Host Nginx Configuration
Since the frontend container is running on port 3000, you need to update your host's Nginx configuration (`/etc/nginx/sites-available/zchat.space`) to proxy requests to it.

Replace the `location /` block:

```nginx
    # Proxy everything to the Frontend Docker container
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

### Volume Management
To ensure data persistence, the `docker-compose.yml` defines two named volumes:
- `postgres_data`: Stores the PostgreSQL database files.
- `backend_uploads`: Stores user-uploaded files.

To backup these volumes, you can inspect their location:
```bash
docker volume inspect zchat_postgres_data
docker volume inspect zchat_backend_uploads
```
(Note: The prefix `zchat_` depends on the directory name where `docker-compose.yml` is located.)

### Reload Host Nginx
```bash
sudo systemctl reload nginx
```

---

## 9. Final Testing

### Test All Redirects
- `http://your-server-ip` -> should redirect to `https://zchat.space`
- `https://your-server-ip` -> should redirect to `https://zchat.space`
- `http://zchat.space` -> should redirect to `https://zchat.space`
- `http://www.zchat.space` -> should redirect to `https://www.zchat.space`

### Test Frontend
- Visit `https://zchat.space`
- Check browser console (F12) for any errors
- Verify no CORS errors

### Test Backend API
- Open browser console
- Check Network tab
- Verify API calls go to `https://zchat.space/api/*`
- Verify responses are received correctly

### Test WebSocket Connection (if applicable)
- Open browser console (F12)
- Check Console tab for WebSocket connection messages
- Verify WebSocket connects to `wss://zchat.space/ws` (not `ws://zchat.space:8000/ws`)
- Check Network tab -> WS filter to see WebSocket connection
- Connection should show as "101 Switching Protocols"
- WebSocket messages should appear in the Frames tab

### Common Issues and Solutions

**Issue: CORS errors**
- Check backend `.env` has correct CORS_ORIGINS
- Restart backend: `docker-compose restart`

**Issue: API calls still going to localhost**
- Rebuild frontend: `rm -rf dist && npm run build`
- Verify `.env.production` exists and has `VITE_API_URL=/api`
- Check built files: `grep -r "localhost" dist/`

**Issue: 502 Bad Gateway on /api/**
- Check backend is running: `docker-compose ps`
- Check logs: `docker-compose logs -f`
- Verify port 8000 is exposed in docker-compose.yml

**Issue: SSL certificate errors**
- Check certificate: `sudo certbot certificates`
- Renew if needed: `sudo certbot renew`

**Issue: Changes not appearing**
- Clear browser cache (Ctrl+Shift+R)
- Check file timestamps on server: `ls -la /var/www/zchat.space/`

**Issue: WebSocket connection fails**
- Verify Nginx has `/ws` location block configured
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Verify backend WebSocket is running on port 8000
- Check WebSocket URL in frontend uses relative path `/ws` in production
- Make sure `proxy_read_timeout` is set high enough in Nginx (86400 for 24 hours)

**Issue: WebSocket connects but disconnects immediately**
- Check backend CORS settings include your domain
- Verify `Upgrade` and `Connection` headers in Nginx proxy config
- Check backend logs for WebSocket errors: `docker-compose logs -f`

---

## Deployment Checklist

- [ ] Server setup with Ubuntu
- [ ] Created non-root user with sudo privileges
- [ ] SSH key authentication configured
- [ ] Domain purchased and DNS configured
- [ ] Nginx installed and configured
- [ ] SSL certificate obtained with Let's Encrypt
- [ ] Backend deployed with Docker
- [ ] Backend CORS configured for production domain
- [ ] Frontend built and served by Nginx (in Docker)
- [ ] All redirects working (IP → domain, HTTP → HTTPS)
- [ ] All traffic proxied to Frontend container (port 3000)
- [ ] API calls proxied through Frontend container to Backend container
- [ ] WebSocket connections proxied correctly
- [ ] No CORS errors in browser
- [ ] WebSocket connects via WSS (if applicable)
- [ ] All functionality tested in production

---

## Maintenance

### Update Application (Frontend & Backend)
```bash
# On server
cd ~/zchat
# Pull latest changes if using git
git pull
# Rebuild and restart containers
docker-compose up -d --build
```

### Monitor Logs
```bash
# Nginx logs (Host)
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Docker logs (Frontend & Backend)
docker-compose logs -f
```

### SSL Certificate Renewal
```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

## Security Best Practices

1. **Never commit `.env` files to git**
   ```bash
   echo ".env" >> .gitignore
   echo ".env.local" >> .gitignore
   echo ".env.production" >> .gitignore
   ```

2. **Keep system updated**
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

3. **Use strong passwords** for all users and databases

4. **Configure firewall properly**
   ```bash
   sudo ufw status
   ```

5. **Regular backups** of your database and configuration files

6. **Monitor server resources**
   ```bash
   htop
   df -h
   ```

---

## Support and Resources

- Nginx docs: https://nginx.org/en/docs/
- Let's Encrypt: https://letsencrypt.org/
- Docker docs: https://docs.docker.com/
- Vite docs: https://vitejs.dev/

---

**Document Version:** 1.1  
**Last Updated:** 2026-02-05  
**Domain Example:** zchat.space  
**Includes:** WebSocket configuration and proxying
**Author:** Konstantin Ryakhovskiy