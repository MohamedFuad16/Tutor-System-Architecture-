#!/usr/bin/env bash
# Pull, build, and restart the Tutor voice server on the VM.
# Usage (on the VM): APP_DIR=/opt/tutor-system deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tutor-system}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
echo "==> Updating $APP_DIR ($BRANCH)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Installing dependencies"
npm ci
pip3 install --break-system-packages -r requirements.txt \
  || pip3 install -r requirements.txt

echo "==> Building"
npm run build

echo "==> Restarting service"
sudo systemctl restart tutor-voice
sleep 2
sudo systemctl --no-pager status tutor-voice | head -n 15
echo "==> Done. Tail logs with: journalctl -u tutor-voice -f"
