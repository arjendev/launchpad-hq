#!/usr/bin/env bash
#
# Start the Aspire Dashboard for OpenTelemetry trace visualization.
# Dashboard UI: http://localhost:18888
# OTLP endpoint (gRPC): localhost:4317 (mapped from container port 18889)
#

set -euo pipefail

ACTION="${1:-start}"

case "$ACTION" in
  start)
    if docker ps --format '{{.Names}}' | grep -q '^aspire-dashboard$'; then
      echo "Aspire Dashboard is already running."
      echo "Dashboard: http://localhost:18888"
      exit 0
    fi

    echo "Starting Aspire Dashboard..."
    docker run --rm -d \
      -p 18888:18888 \
      -p 4317:18889 \
      -p 18891:18891 \
      -e DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true \
      -e DOTNET_DASHBOARD_MCP_ENDPOINT_URL=http://+:18891 \
      --name aspire-dashboard \
      mcr.microsoft.com/dotnet/aspire-dashboard:latest

    echo "Aspire Dashboard: http://localhost:18888"
    echo "OTLP gRPC endpoint: http://localhost:4317"
    echo "MCP endpoint: http://localhost:18891"
    ;;

  stop)
    echo "Stopping Aspire Dashboard..."
    docker stop aspire-dashboard 2>/dev/null || echo "Dashboard not running."
    ;;

  status)
    if docker ps --format '{{.Names}}' | grep -q '^aspire-dashboard$'; then
      echo "running"
    else
      echo "stopped"
    fi
    ;;

  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
