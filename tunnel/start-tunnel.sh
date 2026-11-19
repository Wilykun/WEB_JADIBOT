#!/bin/bash
# Start tunnl.gg tunnel for panel on 127.0.0.1:3000
# Usage: start-tunnl.sh [random|stable]  (default random)
MODE="${1:-random}"
USER="proxy.tunnl.gg"
[ "$MODE" = "stable" ] && USER="stable@proxy.tunnl.gg"
setsid nohup ssh -o ProxyCommand="python3 "$(dirname "$0")/proxy_ssh.py" %h %p" \
  -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -i "$HOME/.ssh/tunnl_ed25519" \
  -n -T -R 80:localhost:3000 "$USER" output=json > /tmp/tunnl.log 2>&1 < /dev/null &
echo "tunnl ssh pid $! mode=$MODE log=/tmp/tunnl.log"
