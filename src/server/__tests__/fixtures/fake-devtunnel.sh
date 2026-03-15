#!/bin/bash
# Fake devtunnel binary for testing.
# Mimics the output format of `devtunnel host -p <port>`.
# Handles --version, and stays alive until SIGTERM.

if [ "$1" = "--version" ]; then
  echo "devtunnel version 1.0.0-fake"
  exit 0
fi

PORT="${3:-3000}"

echo "Tunnel ID: fake-tunnel-abc"
echo "Connect via browser: https://fake-tunnel-abc-${PORT}.usw2.devtunnels.ms"

# Use wait (bash builtin) which responds to signals immediately,
# unlike sleep which blocks signal delivery until it completes.
trap "exit 0" TERM INT
sleep infinity &
wait
