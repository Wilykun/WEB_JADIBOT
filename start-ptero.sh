#!/usr/bin/env bash
# Startup runner untuk Pterodactyl. Jalankan melalui `npm start` atau `bash start-ptero.sh`.
set -uo pipefail
cd "$(dirname "$0")"

# Panel memakai Node 20 lokal bila tersedia; fallback ke Node dari PATH.
NODE20_ROOT="${NODE20_ROOT:-$HOME/.local/node-v20.20.2}"
if [[ -x "$NODE20_ROOT/bin/node" ]]; then
  PATH="$NODE20_ROOT/bin:$PATH"
  export PATH
fi

stop_requested=0
child_pid=""
install_pid=""

handle_stop() {
  stop_requested=1
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    echo "Meneruskan sinyal berhenti ke server panel..."
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
  if [[ -n "$install_pid" ]] && kill -0 "$install_pid" 2>/dev/null; then
    kill -TERM "$install_pid" 2>/dev/null || true
  fi
}
trap handle_stop INT TERM

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js tidak ditemukan di PATH." >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || exit 1
if ! [[ "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
  echo "ReadSW Console memerlukan Node.js 20 atau lebih baru." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "node_modules belum ada; memasang dependensi proyek..."
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund --prefer-offline &
  else
    npm install --no-audit --no-fund --prefer-offline &
  fi
  install_pid=$!
  wait "$install_pid"
  install_status=$?
  install_pid=""
  if (( stop_requested )); then
    exit 0
  fi
  if (( install_status != 0 )); then
    echo "Instalasi dependensi gagal (exit code: $install_status)." >&2
    exit "$install_status"
  fi
fi

# Tunnel readsw.my.id: jalanin tunnel tunnl.gg biar panel bisa dibuka lewat domain
if [[ -x "$(dirname "$0")/tunnel/start-tunnel.sh" ]]; then
  echo "Menjalankan tunnel readsw.my.id..."
  "$(dirname "$0")/tunnel/start-tunnel.sh" stable || echo "Tunnel gagal start, panel tetap jalan lokal."
fi

MAX_RESTARTS="${MAX_RESTARTS:-10}"
RESTART_DELAY="${RESTART_DELAY:-5}"
STABLE_UPTIME_SEC="${STABLE_UPTIME_SEC:-180}"
for setting in MAX_RESTARTS RESTART_DELAY STABLE_UPTIME_SEC; do
  if ! [[ "${!setting}" =~ ^[0-9]+$ ]]; then
    echo "$setting harus berupa bilangan bulat non-negatif." >&2
    exit 1
  fi
done

restart_count=0
while true; do
  if (( stop_requested )); then
    exit 0
  fi

  run_started="$(date +%s)"
  echo "Menjalankan ReadSW Console (Node.js $(node -v))..."
  node_args=()
  if [[ -n "${NODE_MAX_OLD_SPACE_SIZE:-}" ]]; then
    if ! [[ "$NODE_MAX_OLD_SPACE_SIZE" =~ ^[0-9]+$ ]] || (( NODE_MAX_OLD_SPACE_SIZE < 128 )); then
      echo "NODE_MAX_OLD_SPACE_SIZE harus bilangan bulat minimal 128 MB." >&2
      exit 1
    fi
    node_args+=("--max-old-space-size=$NODE_MAX_OLD_SPACE_SIZE")
  fi

  node "${node_args[@]}" server/index.js &
  child_pid=$!
  wait "$child_pid"
  exit_code=$?
  child_pid=""

  if (( stop_requested )); then
    echo "Server panel dihentikan dengan aman."
    exit 0
  fi
  if (( exit_code == 0 )); then
    echo "Server panel berhenti normal."
    exit 0
  fi

  elapsed=$(( $(date +%s) - run_started ))
  if (( elapsed >= STABLE_UPTIME_SEC )); then
    restart_count=0
  fi
  restart_count=$((restart_count + 1))
  echo "Server berhenti dengan exit code $exit_code setelah ${elapsed}s; percobaan restart $restart_count/$MAX_RESTARTS dalam ${RESTART_DELAY}s."
  if (( restart_count >= MAX_RESTARTS )); then
    echo "Batas restart beruntun tercapai; menghentikan startup runner." >&2
    exit "$exit_code"
  fi

  sleep "$RESTART_DELAY"
  if (( stop_requested )); then
    echo "Startup runner dihentikan."
    exit 0
  fi
done
