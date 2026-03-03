#!/usr/bin/env bash
# AEP — GCP VM setup script
# Run once as root or sudo on Ubuntu 22.04 LTS
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Rowntrees/AEP.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aep}"
DATA_DIR="${DATA_DIR:-/opt/aep/data}"

echo "===> Installing Docker"
apt-get update -qq
apt-get install -y -qq curl git
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

echo "Docker installed: $(docker --version)"

echo "===> Cloning repo"
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  git pull
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo "===> Creating data directory"
mkdir -p "$DATA_DIR/workspaces"
chmod 777 "$DATA_DIR"

echo "===> Generating .env"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  MASTER_KEY=$(openssl rand -hex 32)
  DB_PASS=$(openssl rand -hex 16)

  cat > "$INSTALL_DIR/.env" <<EOF
POSTGRES_USER=aep
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=aep
DATABASE_URL=postgres://aep:${DB_PASS}@db:5432/aep
MASTER_KEY=${MASTER_KEY}
PORT=3001
DATA_HOST_PATH=${DATA_DIR}
AEP_NETWORK=aep-network
AGENT_IMAGE=aep-agent-runtime:latest
EOF
  echo ".env created with fresh keys."
else
  echo ".env already exists — skipping."
fi

echo "===> Building images"
cd "$INSTALL_DIR"
docker compose build

echo "===> Building agent-runtime image"
docker build -t aep-agent-runtime:latest ./agent-runtime

echo "===> Starting services"
docker compose up -d

echo ""
echo "=============================================="
echo " AEP is running!"
echo "  Frontend: http://$(curl -sf https://ipinfo.io/ip 2>/dev/null || echo 'YOUR_IP'):3000"
echo "  API:      http://$(curl -sf https://ipinfo.io/ip 2>/dev/null || echo 'YOUR_IP'):3001"
echo "=============================================="
echo ""
echo "Open GCP firewall for TCP 3000 and 3001 if you haven't already."
