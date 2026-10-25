#!/bin/sh
# Build the web version of the app and put it on the server (served at https://orderdesk.kamkarao.com/app).
# Run from the repo root on the laptop (Git Bash):  sh deploy/web-deploy.sh
# Needs: Node 22, the server SSH key. No restart needed; the backend serves the new files at once.
set -eu
KEY="${ORDERDESK_SSH_KEY:-$HOME/.ssh/kamkarao.key}"
HOST="${ORDERDESK_HOST:-ubuntu@140.245.242.194}"
API="${ORDERDESK_API_URL:-https://orderdesk.kamkarao.com}"

cd "$(dirname "$0")/../mobile"
rm -rf dist
EXPO_PUBLIC_API_URL="$API" npx.cmd expo export --platform web --output-dir dist 2>/dev/null || EXPO_PUBLIC_API_URL="$API" npx expo export --platform web --output-dir dist
test -f dist/index.html

tar -czf /tmp/orderdesk-web.tgz -C dist .
scp -q -i "$KEY" /tmp/orderdesk-web.tgz "$HOST:/tmp/orderdesk-web.tgz"
ssh -i "$KEY" "$HOST" 'set -eu
  # Replace the contents in place: the backend container has this folder mounted, not a copy.
  mkdir -p ~/orderdesk-web ~/orderdesk-web.new
  find ~/orderdesk-web.new -mindepth 1 -delete
  tar -xzf /tmp/orderdesk-web.tgz -C ~/orderdesk-web.new && rm /tmp/orderdesk-web.tgz
  test -f ~/orderdesk-web.new/index.html
  find ~/orderdesk-web -mindepth 1 -delete
  cp -a ~/orderdesk-web.new/. ~/orderdesk-web/
  rm -rf ~/orderdesk-web.new
  echo "web app files: $(find ~/orderdesk-web -type f | wc -l)"'
rm -f /tmp/orderdesk-web.tgz
echo "Done: $API/app/"
