#!/bin/bash

echo "=== Stopping Gateway ==="
kill $(lsof -t -i:5051) 2>/dev/null || true

echo "=== Stopping Oracle ==="
kill $(lsof -t -i:5050) 2>/dev/null || true

echo "=== Stopping IPFS ==="
kill $(lsof -t -i:5001) 2>/dev/null || true

echo "=== Stopping Fabric network ==="
cd /opt/caac/fabric-samples/test-network
./network.sh down -i 2.5.12 -cai 1.5.15

echo "✅ All services stopped"
