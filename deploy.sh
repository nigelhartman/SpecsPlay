#!/bin/bash
# SpecsPlay Production Deployment Script
# 
# This script deploys the SpecsPlay backend to a production server.
# Configuration is read from .env file in the project root.
#
# Requirements:
# - SSH access to the deployment server
# - Docker and Docker Compose installed on the server
# - .env file configured with API keys and deployment details

set -e

# Default deployment configuration
# These can be overridden by setting them in .env
SERVER="${DEPLOY_SERVER:-5.223.74.196}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/hetzner_private}"
REMOTE_DIR="/opt/specsplay"

echo "==> Deploying to $SERVER..."

# Start ssh-agent and add key once so passphrase is only prompted once
eval "$(ssh-agent -s)" > /dev/null
ssh-add "$SSH_KEY" 2>/dev/null || {
  echo "ERROR: SSH key not found at $SSH_KEY"
  exit 1
}
trap "ssh-agent -k > /dev/null" EXIT

# Load local .env to get API keys and configuration
if [ ! -f "$(dirname "$0")/.env" ]; then
  echo "ERROR: .env file not found at project root"
  echo "Please copy .env.example to .env and configure it with your API keys"
  exit 1
fi
source "$(dirname "$0")/.env"

# Validate API keys
if [ -z "$GEMINI_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ]; then
  echo "ERROR: Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set in .env"
  echo "Please configure at least one API key in .env"
  exit 1
fi

# Verify BASE_URL is set for production
if [ -z "$BASE_URL" ]; then
  echo "ERROR: BASE_URL is not set in .env"
  echo "Please set BASE_URL to your production domain (e.g., https://your-domain.com)"
  exit 1
fi

# Create remote directory and write .env
echo "==> Creating remote directory and writing .env..."
ssh -i "$SSH_KEY" "root@$SERVER" "mkdir -p $REMOTE_DIR"

ssh -i "$SSH_KEY" "root@$SERVER" "cat > $REMOTE_DIR/.env" <<EOF
GEMINI_API_KEY=${GEMINI_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
SECRET_KEY=${SECRET_KEY}
BASE_URL=${BASE_URL}
PORT=${PORT:-3000}
EOF

# Copy backend files
echo "==> Copying backend files..."
scp -i "$SSH_KEY" \
  "$(dirname "$0")/backend/server.js" \
  "$(dirname "$0")/backend/package.json" \
  "$(dirname "$0")/backend/package-lock.json" \
  "$(dirname "$0")/backend/Dockerfile" \
  "$(dirname "$0")/backend/docker-compose.yml" \
  "$(dirname "$0")/backend/Caddyfile" \
  "root@$SERVER:$REMOTE_DIR/"

# Build and restart on server
echo "==> Building and starting containers..."
ssh -i "$SSH_KEY" "root@$SERVER" "
  cd $REMOTE_DIR
  docker compose pull caddy 2>/dev/null || true
  docker compose up --build --force-recreate -d
  docker compose ps
"

echo ""
echo "✓ Deployment complete!"
echo "==> Service running at $BASE_URL"
echo "==> View logs with:  ssh -i $SSH_KEY root@$SERVER 'cd $REMOTE_DIR && docker compose logs -f'"
