#!/bin/bash
set -e

cd /opt/caac
source ./caac-env.sh

export PATH=/opt/caac/bin:/opt/caac/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/opt/caac/fabric-samples/config
export CONTAINER_CLI=docker
export CONTAINER_CLI_COMPOSE=docker-compose

echo "=== Starting Fabric network ==="
cd /opt/caac/fabric-samples/test-network
./network.sh up createChannel -c mychannel -ca -i 2.5.12 -cai 1.5.15
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java

echo "=== Starting IPFS ==="
cd /opt/caac
export IPFS_PATH=/opt/caac/ipfs-repo
rm -f "$IPFS_PATH/repo.lock"
nohup env IPFS_PATH="$IPFS_PATH" /opt/caac/bin/ipfs daemon --offline \
    > /opt/caac/logs/ipfs.log 2>&1 &
sleep 5

echo "=== Starting Oracle ==="
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-oracle/target/demo-0.0.1-SNAPSHOT.jar' \
    > /opt/caac/logs/oracle.log 2>&1 &
sleep 5

echo "=== Starting Gateway ==="
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &
sleep 5

echo "=== Verification ==="
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051'
curl -s http://127.0.0.1:5051/api/files/health | jq

echo "✅ All services started successfully"
