#!/usr/bin/env bash
# Axiom World State — start script
# Loads .env, kills any existing servers, starts API + UI dev server

set -a
source "$(dirname "$0")/.env"
set +a

cd "$(dirname "$0")"

echo "[Axiom] Stopping existing servers..."
lsof -ti:3333 | xargs kill -9 2>/dev/null
lsof -ti:5175 | xargs kill -9 2>/dev/null
sleep 1

echo "[Axiom] Starting API server on port ${PORT:-3333}..."
nohup node dist/src/server/api.js > /tmp/axiom-api.log 2>&1 &
API_PID=$!
echo "[Axiom] API PID: $API_PID"

echo "[Axiom] Starting UI dev server on port 5175..."
cd ui && nohup pnpm dev --port 5175 --host > /tmp/axiom-ui.log 2>&1 &
UI_PID=$!
echo "[Axiom] UI PID: $UI_PID"

sleep 2
echo "[Axiom] API log:"
tail -3 /tmp/axiom-api.log
echo "[Axiom] UI log:"
tail -3 /tmp/axiom-ui.log
echo ""
echo "[Axiom] App ready at: ${APP_URL:-http://localhost:5175}"
echo "[Axiom] API ready at: http://localhost:${PORT:-3333}"
