#!/usr/bin/env bash

set -euo pipefail

NEW_USER="kr"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_NAME="$(basename "$SCRIPT_PATH")"


if [[ $EUID -eq 0 ]]; then
    echo "[root] Running as root."

    # Create the user if it does not exist yet
    if id "$NEW_USER" &>/dev/null; then
        echo "[root] User '$NEW_USER' already exists, skipping creation."
    else
        echo "[root] Creating user '$NEW_USER'..."
        useradd --create-home --shell /bin/bash "$NEW_USER"
        passwd "$NEW_USER"
    fi

    if id -nG "$NEW_USER" | tr ' ' '\n' | grep -qx sudo; then
        echo "[root] '$NEW_USER' is already in group 'sudo'."
    else
        echo "[root] Adding '$NEW_USER' to group 'sudo'..."
        usermod -aG "$SUDO_GROUP" "$NEW_USER"
    fi

    NEW_HOME="$(getent passwd "$NEW_USER" | cut -d: -f6)"
    NEW_GROUP="$(id -gn "$NEW_USER")"
    TARGET="$NEW_HOME/$SCRIPT_NAME"

    echo "[root] Copying script to $TARGET"
    cp "$SCRIPT_PATH" "$TARGET"
    chown "$NEW_USER" "$TARGET"
    chgrp "$NEW_GROUP" "$TARGET"
    chmod 750 "$TARGET"

    echo "[root] Switching to '$NEW_USER' and restarting script..."
    # exec replaces the root process; NEW_USER is passed along explicitly
    exec su - "$NEW_USER" -c "NEW_USER=$(printf '%q' "$NEW_USER") $(printf '%q' "$TARGET")"
fi

##################################

echo "[user] Now running as: $(whoami)"
echo "[user] Home directory: $HOME"
echo "[user] Script location: $SCRIPT_PATH"


##################################

sudo -v

echo "configure docker"

# Remove conflicting packages (only if installed)
OLD_PKGS="$(dpkg --get-selections docker.io docker-compose docker-compose-v2 \
    docker-doc podman-docker containerd runc 2>/dev/null | cut -f1 || true)"
if [[ -n "$OLD_PKGS" ]]; then
    # shellcheck disable=SC2086
    sudo apt-get remove -y $OLD_PKGS
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
sudo systemctl status docker --no-pager

# The docker-ce package normally creates the group already
getent group docker >/dev/null || sudo groupadd docker
sudo usermod -aG docker "$(id -un)"

# Verify (sg applies the new group without needing a re-login)
docker compose version

echo "[user] Done. Log out and back in so the docker group applies to new shells."

##################################

echo "configure git"
sudo apt-get install git

##################################

echo "configure folders"
mkdir etracker
mkdir zchat

##################################

echo "configure cloudflared"
# Add cloudflare gpg key
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

# Add this repo to your apt repositories
# Stable
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
# Nightly
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://next.pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

# install cloudflared
sudo apt-get update && sudo apt-get install cloudflared

##################################

echo "configure mtproto"
git clone https://github.com/ryakhovskiy/mtprotoproxy.git
cd mtprotoproxy

#docker-compose up -d --build
#docker compose logs
