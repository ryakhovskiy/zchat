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
Instead of using root, create a dedicated user (example: `kr`):

```bash
# As root user
adduser kr

# Add to sudo group
usermod -aG sudo kr

# Switch to new user
su - kr
```

---

## 3. SSH Key Setup

### On Your Local Computer

Generate a new SSH key pair:

```bash
ssh-keygen -t ed25519 -C "kr@your-server"
```

Follow the prompts:
- Save location: default (`~/.ssh/id_ed25519`) or custom path
- Passphrase: recommended for security

### Copy Public Key to Server

**Option A: Using ssh-copy-id (easiest)**
```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub kr@your-server-ip
```

**Option B: Manual method**
```bash
# On local machine - copy your public key
cat ~/.ssh/id_ed25519.pub
```

Then on the server (as root):
```bash
mkdir -p /home/kr/.ssh
nano /home/kr/.ssh/authorized_keys
# Paste the public key, save and exit

# Set proper permissions
chown -R kr:kr /home/kr/.ssh
chmod 700 /home/kr/.ssh
chmod 600 /home/kr/.ssh/authorized_keys
```

### Test SSH Connection
```bash
ssh kr@your-server-ip
```

### Optional: Create SSH Config (Local Machine)
Edit `~/.ssh/config`:
```
Host myserver
    HostName your-server-ip
    User kr
    IdentityFile ~/.ssh/id_ed25519
```

Then connect with: `ssh myserver`

### Optional: Disable Root SSH Login
After confirming your user works:
```bash
sudo nano /etc/ssh/sshd_config
```

Change:
```
PermitRootLogin no
```

Restart SSH:
```bash
sudo systemctl restart sshd
```

---

## 4. Domain Configuration

### Purchase Domain
Use any domain registrar (Namecheap, Cloudflare, GoDaddy, etc.)

Example domain: `zchat.space`

### Configure DNS Records

In your domain registrar's DNS management panel, add:

**A Record for root domain:**
```
Type: A
Host: @
Value: your-server-ip-address
TTL: Automatic (or 300-3600)
```

**A Record for www subdomain:**
```
Type: A
Host: www
Value: your-server-ip-address
TTL: Automatic (or 300-3600)
```

**Wait for DNS propagation** (usually 10-30 minutes, can take up to 48 hours)

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
sudo nano /etc/nginx/sites-available/zchat.space
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

**Auto-renewal is configured automatically!** Test it with:
```bash
sudo certbot renew --dry-run
```

---

## 6. Nginx Configuration

### Final Nginx Configuration with Redirects

```bash
sudo nano /etc/nginx/sites-available/zchat.space
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
    
    root /var/www/zchat.space;
    index index.html;
    
    # Proxy API requests to Docker backend
    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Proxy WebSocket connections
    location /ws {
        proxy_pass http://localhost:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400; # 24 hours - keep WebSocket connections alive
    }
    
    # Serve frontend files
    location / {
        try_files $uri $uri/ =404;
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
- ✅ `http://your-ip` → `https://zchat.space`
- ✅ `https://your-ip` → `https://zchat.space`
- ✅ `http://zchat.space` → `https://zchat.space`
- ✅ `http://www.zchat.space` → `https://www.zchat.space`
- ✅ Proxies `/api/*` requests to backend on port 8000
- ✅ Serves frontend from `/var/www/zchat.space`

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

### Prepare Backend

**Example directory structure:**
```
~/backend/
├── Dockerfile
├── docker-compose.yml
├── .env
└── ... (your backend code)
```

### Configure Environment Variables

Create `.env` file for your backend:
```bash
nano ~/backend/.env
```

**Important:** Update CORS origins to include your domain:
```env
# Backend configuration
PORT=8000

# CORS - Allow your domain
CORS_ORIGINS=["https://zchat.space", "https://www.zchat.space", "http://localhost:5173"]

# Database and other configs...
DATABASE_URL=postgresql://user:password@db:5432/dbname

# WebSocket configuration (if applicable)
WS_PORT=8000
```

### Example docker-compose.yml
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    restart: unless-stopped
```

### Deploy Backend
```bash
cd ~/backend
docker-compose up -d --build
```

### Verify Backend is Running
```bash
docker-compose ps
docker-compose logs -f

# Test locally
curl http://localhost:8000/api/health
```

### Useful Docker Commands
```bash
# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

---

## 8. Frontend Deployment (Vite)

### Prepare Frontend Locally

**Directory structure:**
```
your-frontend-project/
├── .env.local              # Local development
├── .env.production         # Production build
├── package.json
├── vite.config.js
├── src/
└── dist/                   # Generated after build
```

### Configure Environment Variables

**`.env.local` (for local development):**
```env
VITE_API_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000/ws
```

**`.env.production` (for production build):**
```env
VITE_API_URL=/api
VITE_WS_URL=/ws
```

**Important:** The production URLs are relative (`/api` and `/ws`) because Nginx proxies them!

### Update Your Code

Make sure your code uses the environment variables:

**For API calls:**
```javascript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Use it in your API calls
fetch(`${API_BASE_URL}/auth/login`, {
  method: 'POST',
  // ...
});
```

**For WebSocket connections:**
```javascript
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws';

// Helper to convert relative URLs to absolute WebSocket URLs
const getWebSocketUrl = (path) => {
  if (path.startsWith('ws://') || path.startsWith('wss://')) {
    return path; // Already a full URL (local dev)
  }
  
  // For production - use current page protocol
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}${path}`;
};

// Create WebSocket connection
const wsUrl = getWebSocketUrl(WS_URL);
const socket = new WebSocket(wsUrl);
```

### Optional: Vite Proxy for Local Development

Add to `vite.config.js` to use `/api` in development too:
```javascript
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  }
}
```

This way you can use `VITE_API_URL=/api` everywhere!

### Build for Production

```bash
# Clean previous builds
rm -rf dist node_modules/.vite

# Build
npm run build
# or
npx vite build --mode production
```

### Verify Build
```bash
# Make sure localhost:8000 is NOT in the build
grep -r "localhost:8000" dist/

# Should return nothing if VITE_API_URL is properly set
```

### Deploy to Server

**Option A: Build locally, upload to server**
```bash
# From your local machine
scp -r dist/* kr@your-server-ip:/var/www/zchat.space/
```

**Option B: Build on server**
```bash
# Clone your repo on the server
cd ~
git clone https://github.com/yourusername/your-frontend.git
cd your-frontend

# Install dependencies and build
npm install
npm run build

# Copy to web directory
sudo cp -r dist/* /var/www/zchat.space/
```

### Set Proper Permissions
```bash
sudo chown -R www-data:www-data /var/www/zchat.space
sudo chmod -R 755 /var/www/zchat.space
```

### Reload Nginx
```bash
sudo systemctl reload nginx
```

---

## 9. Final Testing

### Test All Redirects
- `http://your-server-ip` → should redirect to `https://zchat.space`
- `https://your-server-ip` → should redirect to `https://zchat.space`
- `http://zchat.space` → should redirect to `https://zchat.space`
- `http://www.zchat.space` → should redirect to `https://www.zchat.space`

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
- Check Network tab → WS filter to see WebSocket connection
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
- [ ] Frontend built with correct environment variables
- [ ] Frontend deployed to /var/www/
- [ ] All redirects working (IP → domain, HTTP → HTTPS)
- [ ] API calls proxied through Nginx
- [ ] WebSocket connections proxied through Nginx (if applicable)
- [ ] No CORS errors in browser
- [ ] WebSocket connects via WSS (if applicable)
- [ ] All functionality tested in production

---

## Maintenance

### Update Frontend
```bash
# On local machine - make changes, then:
npm run build
scp -r dist/* kr@your-server-ip:/var/www/zchat.space/
```

### Update Backend
```bash
# On server
cd ~/backend
git pull  # or upload new code
docker-compose up -d --build
```

### Monitor Logs
```bash
# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Backend logs
docker-compose logs -f
```

### SSL Certificate Renewal
Automatic! But you can manually renew:
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

## Budget-Friendly Hosting Options

- **Hetzner**: €4.15/month (~$4.50) - Best value
- **DigitalOcean**: $6/month - Beginner-friendly
- **Vultr**: $6/month - Similar to DigitalOcean
- **Linode**: $5/month - Reliable
- **Oracle Cloud**: FREE tier available (1GB RAM)

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
