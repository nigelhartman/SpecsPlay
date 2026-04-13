#!/bin/bash
set -e

SERVER="5.223.74.196"
SSH_KEY="$HOME/.ssh/hetzner_private"
REMOTE_DIR="/opt/specsplay"

echo "==> Deploying to $SERVER..."

# Load local .env to get API keys
if [ ! -f "$(dirname "$0")/.env" ]; then
  echo "ERROR: .env file not found at project root"
  exit 1
fi
source "$(dirname "$0")/.env"

if [ -z "$GEMINI_API_KEY" ] && [ -z "$OPENROUTER_API_KEY" ]; then
  echo "ERROR: Neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set in .env"
  exit 1
fi

# Create remote directory and write .env
echo "==> Creating remote directory and writing .env..."
ssh -i "$SSH_KEY" "root@$SERVER" "mkdir -p $REMOTE_DIR"

ssh -i "$SSH_KEY" "root@$SERVER" "cat > $REMOTE_DIR/.env" <<EOF
GEMINI_API_KEY=${GEMINI_API_KEY}
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
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
  docker compose up --build -d
  docker compose ps
"

echo ""
echo "==> Done! Service running at https://specsplay.functionforest.com"
echo "==> Check logs with:  ssh -i ~/.ssh/hetzner_private root@$SERVER 'cd /opt/specsplay && docker compose logs -f'"
