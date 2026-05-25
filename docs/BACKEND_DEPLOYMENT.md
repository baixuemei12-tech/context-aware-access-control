# CAAC 后端部署文档

**版本**: 1.0  
**适用环境**: Ubuntu 20.04 LTS  
**部署路径**: `/opt/caac`  
**最后更新**: 2026-05-22

---

## 目录

1. [系统要求](#1-系统要求)
2. [依赖安装](#2-依赖安装)
3. [目录结构](#3-目录结构)
4. [环境配置](#4-环境配置)
5. [构建应用](#5-构建应用)
6. [部署步骤](#6-部署步骤)
7. [服务管理](#7-服务管理)
8. [验证部署](#8-验证部署)
9. [故障排查](#9-故障排查)
10. [维护操作](#10-维护操作)

---

## 1. 系统要求

### 1.1 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 4 核 | 8 核 |
| 内存 | 8 GB | 16 GB |
| 磁盘 | 50 GB | 100 GB SSD |
| 网络 | 100 Mbps | 1 Gbps |

### 1.2 软件依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Ubuntu | 20.04 LTS | 操作系统 |
| Docker | 26.1.3+ | 容器运行时 |
| Java (OpenJDK) | 21.0.7+ | 运行 Spring Boot 应用 |
| Maven | 3.6.3+ | 构建工具（可选，项目自带 mvnw） |
| jq | 1.6+ | JSON 处理工具 |
| Fabric binaries | 2.5.12 | Peer、Orderer、CLI 工具 |
| Fabric CA binaries | 1.5.15 | 证书颁发机构 |
| Kubo (IPFS) | v0.32.1 | 分布式文件存储 |

### 1.3 网络端口

| 端口 | 服务 | 访问范围 | 说明 |
|------|------|----------|------|
| 5001 | IPFS API | 127.0.0.1 | 仅本地访问 |
| 5050 | Oracle | 127.0.0.1 | 仅本地访问（安全隔离） |
| 5051 | Gateway | 0.0.0.0 | 对外提供 API |
| 7050 | Orderer | 0.0.0.0 | Fabric 排序服务 |
| 7051 | Peer | 0.0.0.0 | Fabric 节点 |
| 8080 | IPFS Gateway | 127.0.0.1 | IPFS HTTP 网关 |
| 9443 | Peer Operations | 0.0.0.0 | Fabric 运维接口 |

---

## 2. 依赖安装

### 2.1 系统包

```bash
sudo apt-get update
sudo apt-get install -y \
    curl \
    wget \
    git \
    jq \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release
```

### 2.2 Docker

```bash
# 添加 Docker 官方 GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加 Docker 仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 将当前用户加入 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 验证
docker --version
docker compose version
```

### 2.3 Java (OpenJDK 21)

```bash
sudo apt-get install -y openjdk-21-jdk
java -version
```

### 2.4 Hyperledger Fabric

#### 下载 Fabric 二进制和 Docker 镜像

```bash
mkdir -p /opt/caac
cd /opt/caac

# 下载 fabric-samples（包含 bin、config、示例）
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.12 1.5.15

# 或使用项目提供的离线包
cp -a /data1/flexiguard/backend/fabric-samples /opt/caac/

# 验证二进制
/opt/caac/fabric-samples/bin/peer version
/opt/caac/fabric-samples/bin/fabric-ca-client version
```

#### 拉取 Docker 镜像

```bash
docker pull hyperledger/fabric-peer:2.5.12
docker pull hyperledger/fabric-orderer:2.5.12
docker pull hyperledger/fabric-ccenv:2.5.12
docker pull hyperledger/fabric-baseos:2.5.12
docker pull hyperledger/fabric-tools:2.5.12
docker pull hyperledger/fabric-ca:1.5.15

# 标记为 latest（兼容性）
docker tag hyperledger/fabric-peer:2.5.12 hyperledger/fabric-peer:latest
docker tag hyperledger/fabric-orderer:2.5.12 hyperledger/fabric-orderer:latest
docker tag hyperledger/fabric-ccenv:2.5.12 hyperledger/fabric-ccenv:latest
docker tag hyperledger/fabric-baseos:2.5.12 hyperledger/fabric-baseos:latest
docker tag hyperledger/fabric-tools:2.5.12 hyperledger/fabric-tools:latest
docker tag hyperledger/fabric-ca:1.5.15 hyperledger/fabric-ca:latest

# 验证
docker images | grep hyperledger/fabric
```

### 2.5 IPFS (Kubo)

```bash
cd /tmp
wget https://dist.ipfs.tech/kubo/v0.32.1/kubo_v0.32.1_linux-amd64.tar.gz
tar -xzf kubo_v0.32.1_linux-amd64.tar.gz
sudo install -m 755 kubo/ipfs /opt/caac/bin/ipfs

# 验证
/opt/caac/bin/ipfs version
# 期望输出: ipfs version 0.32.1
```

---

## 3. 目录结构

### 3.1 创建目录

```bash
sudo mkdir -p /opt/caac/{bin,ipfs-repo,caac-oracle/target,caac-gateway/target,logs}
sudo chown -R $USER:$USER /opt/caac
```

### 3.2 标准目录布局

```
/opt/caac/
├── bin/
│   └── ipfs                          # IPFS 二进制
├── fabric-samples/                   # Fabric 工具链
│   ├── bin/                          # peer, orderer, fabric-ca-client 等
│   ├── config/                       # configtx.yaml, core.yaml 等
│   ├── test-network/                 # 测试网络脚本
│   └── caac-chaincode/               # CAAC 智能合约
├── ipfs-repo/                        # IPFS 数据仓库
│   ├── blocks/
│   ├── config
│   ├── datastore/
│   └── keystore/
├── caac-oracle/
│   └── target/
│       └── demo-0.0.1-SNAPSHOT.jar   # Oracle JAR
├── caac-gateway/
│   └── target/
│       └── caac-gateway-1.0-SNAPSHOT.jar  # Gateway JAR
├── logs/                             # 日志目录
│   ├── ipfs.log
│   ├── oracle.log
│   └── gateway.log
├── caac-env.sh                       # 环境变量配置
├── start-all.sh                      # 启动脚本
└── stop-all.sh                       # 停止脚本
```

---

## 4. 环境配置

### 4.1 创建 caac-env.sh

```bash
cat > /opt/caac/caac-env.sh <<'EOF'
#!/bin/bash
# CAAC Gateway 环境配置
# 使用方法: source /opt/caac/caac-env.sh

# === Core URLs ===
export CAAC_BASE_URL='http://10.216.217.146:5051'
export CAAC_IPFS_API_URL='http://127.0.0.1:5001'
export CAAC_IPFS_GATEWAY_URL='http://127.0.0.1:8080/ipfs'
export CAAC_IPFS_PATH='/opt/caac/ipfs-repo'

# === Fabric Configuration ===
export CAAC_FABRIC_CRYPTO_PATH='/opt/caac/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'

# === Security Keys ===
export CAAC_INITIAL_ADMIN_PASSWORD='<CHANGE_ME>'
export CAAC_ORACLE_HMAC_KEY='<GENERATE_WITH_openssl_rand_-hex_32>'
export CAAC_AUDIT_HMAC_KEY='<GENERATE_WITH_openssl_rand_-hex_32>'

# === Email Configuration ===
export CAAC_MAIL_USERNAME='your-email@example.com'
export CAAC_MAIL_PASSWORD='<EMAIL_AUTH_CODE>'

# === Captcha Configuration ===
export CAAC_HCAPTCHA_SITEKEY='<YOUR_HCAPTCHA_SITEKEY>'
export CAAC_HCAPTCHA_SECRET='<YOUR_HCAPTCHA_SECRET>'

# === Feature Toggles ===
export CAAC_CAPTCHA_ENABLED=true
export CAAC_CAPTCHA_PROVIDER=both  # both/auto/math
export CAAC_EMAIL_VERIFICATION_ENABLED=true
export CAAC_PHONE_VERIFICATION_ENABLED=false
export CAAC_ADMIN_APPROVAL_REQUIRED=false

# === CORS Configuration ===
export CAAC_CORS_ALLOWED_ORIGINS='http://10.216.217.146,http://10.216.217.146:5052,http://127.0.0.1:5052,http://localhost:5052'

# === Frontend URL ===
export CAAC_FRONTEND_LOGIN_URL='http://10.216.217.146/icenter/login.html'
EOF

chmod +x /opt/caac/caac-env.sh
```

### 4.2 生成安全密钥

```bash
# 生成 HMAC 密钥
echo "CAAC_ORACLE_HMAC_KEY=$(openssl rand -hex 32)"
echo "CAAC_AUDIT_HMAC_KEY=$(openssl rand -hex 32)"

# 生成管理员密码
echo "CAAC_INITIAL_ADMIN_PASSWORD=$(openssl rand -base64 12)"
```

将生成的值填入 `caac-env.sh` 对应位置。

### 4.3 配置 IPFS

```bash
export IPFS_PATH=/opt/caac/ipfs-repo
/opt/caac/bin/ipfs init

# 配置 API 和 Gateway 地址
/opt/caac/bin/ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
/opt/caac/bin/ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080

# 验证配置
/opt/caac/bin/ipfs config Addresses.API
/opt/caac/bin/ipfs config Addresses.Gateway
```

---

## 5. 构建应用

### 5.1 获取源码

```bash
cd /opt/caac
git clone <CAAC_REPOSITORY_URL> caac-source
# 或从 /data1/flexiguard/backend 拷贝
cp -a /data1/flexiguard/backend/caac-oracle /opt/caac/caac-source/
cp -a /data1/flexiguard/backend/caac-gateway /opt/caac/caac-source/
```

### 5.2 构建 Oracle

```bash
cd /opt/caac/caac-source/caac-oracle

# 使用项目自带的 Maven Wrapper
./mvnw clean package -DskipTests

# 或使用系统 Maven
mvn clean package -DskipTests

# 拷贝产物
cp target/demo-0.0.1-SNAPSHOT.jar /opt/caac/caac-oracle/target/

# 验证
ls -lh /opt/caac/caac-oracle/target/demo-0.0.1-SNAPSHOT.jar
```

### 5.3 构建 Gateway

```bash
cd /opt/caac/caac-source/caac-gateway

./mvnw clean package -DskipTests

cp target/caac-gateway-1.0-SNAPSHOT.jar /opt/caac/caac-gateway/target/

# 验证
ls -lh /opt/caac/caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar
```

### 5.4 构建 Chaincode

```bash
cd /opt/caac/fabric-samples/caac-chaincode

# 使用 Gradle Wrapper
./gradlew --no-daemon clean installDist

# 验证
ls -lh build/install/caac/lib/chaincode.jar
```

---

## 6. 部署步骤

### 6.1 Phase 1: 启动 Fabric 网络

```bash
cd /opt/caac
source ./caac-env.sh

# 设置 Fabric 环境变量
export PATH=/opt/caac/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/opt/caac/fabric-samples/config
export CONTAINER_CLI=docker
export CONTAINER_CLI_COMPOSE=docker-compose

cd /opt/caac/fabric-samples/test-network

# 清理旧网络（如果存在）
./network.sh down -i 2.5.12 -cai 1.5.15

# 启动网络并创建通道
./network.sh up createChannel -c mychannel -ca -i 2.5.12 -cai 1.5.15

# 验证网络状态
docker ps | grep -E "peer|orderer"
ss -ltnp | grep -E ':7050|:7051'
```

**期望输出**：
- 5 个容器运行中：orderer、peer0.org1、peer0.org2、ca_org1、ca_org2
- 端口 7050 (orderer) 和 7051 (peer) 监听中

### 6.2 Phase 2: 部署 Chaincode

```bash
cd /opt/caac/fabric-samples/test-network

./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java

# 验证 chaincode 容器
docker ps | grep "dev-peer.*-caac"
```

**期望输出**：
- 2 个 chaincode 容器运行中（每个 peer 一个）

### 6.3 Phase 3: 启动 IPFS

```bash
cd /opt/caac
source ./caac-env.sh

export IPFS_PATH=/opt/caac/ipfs-repo
rm -f "$IPFS_PATH/repo.lock"

nohup env IPFS_PATH="$IPFS_PATH" /opt/caac/bin/ipfs daemon --offline \
    > /opt/caac/logs/ipfs.log 2>&1 &

sleep 5

# 验证
curl -sS -X POST http://127.0.0.1:5001/api/v0/version
ss -ltnp | grep ':5001'
```

**期望输出**：
```json
{"Version":"0.32.1","Commit":"","Repo":"16","System":"amd64/linux","Golang":"go1.23.3"}
```

### 6.4 Phase 4: 启动 Oracle

```bash
cd /opt/caac

nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-oracle/target/demo-0.0.1-SNAPSHOT.jar' \
    > /opt/caac/logs/oracle.log 2>&1 &

sleep 5

# 验证
ss -ltnp | grep ':5050'
tail -20 /opt/caac/logs/oracle.log
```

**期望日志**：
```
Started OracleApplication in X.XXX seconds
```

### 6.5 Phase 5: 启动 Gateway

```bash
cd /opt/caac

nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &

sleep 5

# 验证
ss -ltnp | grep ':5051'
curl -s http://127.0.0.1:5051/api/auth/captcha-config | jq
curl -s http://127.0.0.1:5051/api/files/health | jq
```

**期望输出**：
- `:5051` 监听中
- `captcha-config` 返回验证码配置
- `health` 返回 IPFS 和系统状态

---

## 7. 服务管理

### 7.1 创建启动脚本

```bash
cat > /opt/caac/start-all.sh <<'EOF'
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
EOF

chmod +x /opt/caac/start-all.sh
```

### 7.2 创建停止脚本

```bash
cat > /opt/caac/stop-all.sh <<'EOF'
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
EOF

chmod +x /opt/caac/stop-all.sh
```

### 7.3 手动停止所有服务

按依赖关系**逆序**停止（Gateway → Oracle → IPFS → Fabric）：

```bash
# 1. 停止 Gateway（端口 5051）
kill $(lsof -t -i:5051) 2>/dev/null && echo "Gateway stopped" || echo "Gateway not running"

# 2. 停止 Oracle（端口 5050）
kill $(lsof -t -i:5050) 2>/dev/null && echo "Oracle stopped" || echo "Oracle not running"

# 3. 停止 IPFS（端口 5001）
kill $(lsof -t -i:5001) 2>/dev/null && echo "IPFS stopped" || echo "IPFS not running"

# 4. 停止 Fabric 网络（所有 Docker 容器）
cd /opt/caac/fabric-samples/test-network
export PATH=/opt/caac/fabric-samples/bin:$PATH
./network.sh down -i 2.5.12 -cai 1.5.15

# 5. 验证所有服务已停止
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051'
docker ps | grep -E "peer|orderer"
```

如果 `kill` 未能终止进程，可使用 `kill -9`：

```bash
kill -9 $(lsof -t -i:5051) 2>/dev/null
kill -9 $(lsof -t -i:5050) 2>/dev/null
kill -9 $(lsof -t -i:5001) 2>/dev/null
```

### 7.4 手动启动所有服务

按依赖关系**正序**启动（Fabric → IPFS → Oracle → Gateway）：

```bash
# 0. 加载环境变量
cd /opt/caac
source ./caac-env.sh
export PATH=/opt/caac/bin:/opt/caac/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/opt/caac/fabric-samples/config
export CONTAINER_CLI=docker
export CONTAINER_CLI_COMPOSE=docker-compose

# 1. 启动 Fabric 网络
cd /opt/caac/fabric-samples/test-network
./network.sh up createChannel -c mychannel -ca -i 2.5.12 -cai 1.5.15
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java

# 验证 Fabric
docker ps | grep -E "peer|orderer"
ss -ltnp | grep -E ':7050|:7051'

# 2. 启动 IPFS
cd /opt/caac
export IPFS_PATH=/opt/caac/ipfs-repo
rm -f "$IPFS_PATH/repo.lock"
nohup env IPFS_PATH="$IPFS_PATH" /opt/caac/bin/ipfs daemon --offline \
    > /opt/caac/logs/ipfs.log 2>&1 &
sleep 5

# 验证 IPFS
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq

# 3. 启动 Oracle
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-oracle/target/demo-0.0.1-SNAPSHOT.jar' \
    > /opt/caac/logs/oracle.log 2>&1 &
sleep 8

# 验证 Oracle
ss -ltnp | grep ':5050'
tail -5 /opt/caac/logs/oracle.log

# 4. 启动 Gateway
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &
sleep 5

# 验证 Gateway
ss -ltnp | grep ':5051'
curl -s http://127.0.0.1:5051/api/files/health | jq
```

### 7.5 单个服务重启

#### 重启 Gateway

```bash
kill $(lsof -t -i:5051) 2>/dev/null; sleep 2
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &
```

#### 重启 Oracle

```bash
# 先停止 Gateway（依赖 Oracle）
kill $(lsof -t -i:5051) 2>/dev/null
kill $(lsof -t -i:5050) 2>/dev/null; sleep 2

# 启动 Oracle
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-oracle/target/demo-0.0.1-SNAPSHOT.jar' \
    > /opt/caac/logs/oracle.log 2>&1 &
sleep 8

# 再启动 Gateway
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &
```

#### 重启 IPFS

```bash
kill $(lsof -t -i:5001) 2>/dev/null; sleep 2
export IPFS_PATH=/opt/caac/ipfs-repo
rm -f "$IPFS_PATH/repo.lock"
nohup env IPFS_PATH="$IPFS_PATH" /opt/caac/bin/ipfs daemon --offline \
    > /opt/caac/logs/ipfs.log 2>&1 &
```

### 7.6 使用脚本一键操作

```bash
# 停止所有服务
/opt/caac/stop-all.sh

# 启动所有服务
/opt/caac/start-all.sh

# 重启所有服务（先停后启）
/opt/caac/stop-all.sh && sleep 5 && /opt/caac/start-all.sh
```

### 7.7 systemd 服务配置（推荐）

#### IPFS 服务

```bash
sudo tee /etc/systemd/system/caac-ipfs.service > /dev/null <<'EOF'
[Unit]
Description=CAAC IPFS Kubo daemon offline
After=network.target
Wants=network.target

[Service]
Type=simple
User=icenter
Group=icenter
WorkingDirectory=/opt/caac
Environment=IPFS_PATH=/opt/caac/ipfs-repo
Environment=PATH=/opt/caac/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

ExecStartPre=/bin/bash -c 'mkdir -p "$IPFS_PATH"; [ -f "$IPFS_PATH/config" ] || /opt/caac/bin/ipfs init'
ExecStartPre=/opt/caac/bin/ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ExecStartPre=/opt/caac/bin/ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080

ExecStart=/opt/caac/bin/ipfs daemon --offline
Restart=always
RestartSec=5
StandardOutput=append:/opt/caac/logs/ipfs.log
StandardError=append:/opt/caac/logs/ipfs.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable caac-ipfs.service
sudo systemctl start caac-ipfs.service
```

#### Oracle 服务

```bash
sudo tee /etc/systemd/system/caac-oracle.service > /dev/null <<'EOF'
[Unit]
Description=CAAC Oracle Service
After=network.target caac-ipfs.service
Requires=caac-ipfs.service

[Service]
Type=simple
User=icenter
Group=icenter
WorkingDirectory=/opt/caac

ExecStart=/bin/bash -lc 'source /opt/caac/caac-env.sh && java -jar /opt/caac/caac-oracle/target/demo-0.0.1-SNAPSHOT.jar'
Restart=always
RestartSec=10
StandardOutput=append:/opt/caac/logs/oracle.log
StandardError=append:/opt/caac/logs/oracle.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable caac-oracle.service
sudo systemctl start caac-oracle.service
```

#### Gateway 服务

```bash
sudo tee /etc/systemd/system/caac-gateway.service > /dev/null <<'EOF'
[Unit]
Description=CAAC Gateway Service
After=network.target caac-oracle.service
Requires=caac-oracle.service

[Service]
Type=simple
User=icenter
Group=icenter
WorkingDirectory=/opt/caac

ExecStart=/bin/bash -lc 'source /opt/caac/caac-env.sh && java -jar /opt/caac/caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar'
Restart=always
RestartSec=10
StandardOutput=append:/opt/caac/logs/gateway.log
StandardError=append:/opt/caac/logs/gateway.log

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable caac-gateway.service
sudo systemctl start caac-gateway.service
```

### 7.8 管理 systemd 服务

```bash
# 启动所有服务
sudo systemctl start caac-ipfs caac-oracle caac-gateway

# 停止所有服务
sudo systemctl stop caac-gateway caac-oracle caac-ipfs

# 查看服务状态
sudo systemctl status caac-ipfs
sudo systemctl status caac-oracle
sudo systemctl status caac-gateway

# 查看日志
journalctl -u caac-ipfs -f
journalctl -u caac-oracle -f
journalctl -u caac-gateway -f
```

---

## 8. 验证部署

### 8.1 端口检查

```bash
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051|:9443'
```

**期望输出**：
```
LISTEN   0   4096   127.0.0.1:5001   0.0.0.0:*   users:(("ipfs",pid=XXX,fd=11))
LISTEN   0   100    *:5050           *:*         users:(("java",pid=XXX,fd=393))
LISTEN   0   100    *:5051           *:*         users:(("java",pid=XXX,fd=11))
LISTEN   0   4096   0.0.0.0:7050     0.0.0.0:*
LISTEN   0   4096   0.0.0.0:7051     0.0.0.0:*
LISTEN   0   4096   0.0.0.0:9443     0.0.0.0:*
```

### 8.2 容器检查

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

**期望输出**：
```
NAMES                                       IMAGE                              STATUS
dev-peer0.org2.example.com-caac_1.0-...    dev-peer0.org2.example.com-caac... Up X minutes
dev-peer0.org1.example.com-caac_1.0-...    dev-peer0.org1.example.com-caac... Up X minutes
peer0.org2.example.com                      hyperledger/fabric-peer:2.5.12     Up X minutes
peer0.org1.example.com                      hyperledger/fabric-peer:2.5.12     Up X minutes
orderer.example.com                         hyperledger/fabric-orderer:2.5.12  Up X minutes
ca_org2                                     hyperledger/fabric-ca:1.5.15       Up X minutes
ca_org1                                     hyperledger/fabric-ca:1.5.15       Up X minutes
```

### 8.3 API 端点测试

#### IPFS

```bash
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq
```

**期望输出**：
```json
{
  "Version": "0.32.1",
  "Commit": "",
  "Repo": "16",
  "System": "amd64/linux",
  "Golang": "go1.23.3"
}
```

#### Gateway Health

```bash
curl -s http://127.0.0.1:5051/api/files/health | jq
```

**期望输出**：
```json
{
  "status": "healthy",
  "ipfs": {
    "reachable": true,
    "version": "0.32.1"
  },
  "timestamp": "2026-05-22T10:30:00Z"
}
```

#### Captcha Config

```bash
curl -s http://127.0.0.1:5051/api/auth/captcha-config | jq
```

**期望输出**：
```json
{
  "enabled": true,
  "provider": "both",
  "sitekey": "f90ad46e-..."
}
```

### 8.4 Oracle 隔离验证

```bash
# Oracle 应该只监听 127.0.0.1:5050，外部无法访问
curl -s http://10.216.217.146:5050/api/access/evaluate \
    -X POST -d '{}' --connect-timeout 3
```

**期望输出**：
```
curl: (7) Failed to connect to 10.216.217.146 port 5050: Connection refused
```

### 8.5 Fabric Chaincode 测试

```bash
cd /opt/caac/fabric-samples/test-network

# 设置环境变量
export PATH=/opt/caac/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/opt/caac/fabric-samples/config
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

# 测试 chaincode 调用
peer chaincode query -C mychannel -n caac -c '{"function":"ping","Args":[]}'
```

**期望输出**：
```
pong
```

---

## 9. 故障排查

### 9.1 Oracle 启动失败

#### 错误：找不到 crypto 路径

```
Caused by: java.nio.file.NoSuchFileException: /opt/caac/fabric-samples/test-network/organizations/...
```

**解决方案**：

1. 检查环境变量：
   ```bash
   echo $CAAC_FABRIC_CRYPTO_PATH
   ```

2. 验证路径存在：
   ```bash
   ls "$CAAC_FABRIC_CRYPTO_PATH/users/User1@org1.example.com/msp/signcerts/"
   ```

3. 确保启动前 source 了 caac-env.sh：
   ```bash
   source /opt/caac/caac-env.sh
   ```

#### 错误：无法连接 Fabric peer

```
failed to create new connection: context deadline exceeded
```

**解决方案**：

1. 检查 Fabric 网络是否运行：
   ```bash
   docker ps | grep peer
   ss -ltnp | grep ':7051'
   ```

2. 检查 peer 日志：
   ```bash
   docker logs peer0.org1.example.com
   ```

### 9.2 Gateway 启动失败

#### 错误：无法连接 Oracle

```
Connection refused: http://127.0.0.1:5050
```

**解决方案**：

1. 确认 Oracle 已启动：
   ```bash
   ss -ltnp | grep ':5050'
   ps aux | grep oracle
   ```

2. 检查 Oracle 日志：
   ```bash
   tail -50 /opt/caac/logs/oracle.log
   ```

#### 错误：无法连接 IPFS

```
IPFS API unreachable: http://127.0.0.1:5001
```

**解决方案**：

1. 确认 IPFS 运行：
   ```bash
   ss -ltnp | grep ':5001'
   curl -sS -X POST http://127.0.0.1:5001/api/v0/version
   ```

2. 检查 IPFS 日志：
   ```bash
   tail -50 /opt/caac/logs/ipfs.log
   ```

### 9.3 IPFS 启动失败

#### 错误：repo 不存在

```
Error: no IPFS repo found in /opt/caac/ipfs-repo.
```

**解决方案**：

```bash
export IPFS_PATH=/opt/caac/ipfs-repo
/opt/caac/bin/ipfs init
/opt/caac/bin/ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
/opt/caac/bin/ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
```

#### 错误：端口被占用

```
listen tcp 127.0.0.1:5001: bind: address already in use
```

**解决方案**：

```bash
# 查找占用进程
lsof -i:5001

# 停止旧进程
kill $(lsof -t -i:5001)
```

### 9.4 Fabric 网络问题

#### Chaincode 部署失败

```
Error: chaincode install failed with status: 500
```

**解决方案**：

1. 检查 chaincode 构建：
   ```bash
   cd /opt/caac/fabric-samples/caac-chaincode
   ./gradlew --no-daemon clean installDist
   ls -la build/install/caac/lib/chaincode.jar
   ```

2. 检查 peer 日志：
   ```bash
   docker logs peer0.org1.example.com 2>&1 | grep -i error
   ```

3. 重新部署：
   ```bash
   cd /opt/caac/fabric-samples/test-network
   ./network.sh down
   ./network.sh up createChannel -c mychannel -ca
   ./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java
   ```

### 9.5 日志查看

```bash
# IPFS
tail -f /opt/caac/logs/ipfs.log

# Oracle
tail -f /opt/caac/logs/oracle.log

# Gateway
tail -f /opt/caac/logs/gateway.log

# Fabric peer
docker logs -f peer0.org1.example.com

# Fabric orderer
docker logs -f orderer.example.com

# Chaincode
docker logs -f $(docker ps -q --filter "name=dev-peer0.org1.example.com-caac")
```

---

## 10. 维护操作

### 10.1 重启服务

#### 使用脚本

```bash
/opt/caac/stop-all.sh
sleep 5
/opt/caac/start-all.sh
```

#### 使用 systemd

```bash
sudo systemctl restart caac-gateway
sudo systemctl restart caac-oracle
sudo systemctl restart caac-ipfs
```

### 10.2 更新应用

#### 更新 Oracle

```bash
cd /opt/caac/caac-source/caac-oracle
git pull
./mvnw clean package -DskipTests
cp target/demo-0.0.1-SNAPSHOT.jar /opt/caac/caac-oracle/target/

# 重启
kill $(lsof -t -i:5050)
sleep 2
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-oracle/target/demo-0.0.1-SNAPSHOT.jar' \
    > /opt/caac/logs/oracle.log 2>&1 &
```

#### 更新 Gateway

```bash
cd /opt/caac/caac-source/caac-gateway
git pull
./mvnw clean package -DskipTests
cp target/caac-gateway-1.0-SNAPSHOT.jar /opt/caac/caac-gateway/target/

# 重启
kill $(lsof -t -i:5051)
sleep 2
nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &
```

#### 更新 Chaincode

```bash
cd /opt/caac/fabric-samples/caac-chaincode
git pull
./gradlew --no-daemon clean installDist

cd /opt/caac/fabric-samples/test-network

# 升级 chaincode（版本号递增）
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java -ccv 2.0
```

### 10.3 备份

#### 备份 IPFS 数据

```bash
tar -czf /backup/ipfs-repo-$(date +%Y%m%d).tar.gz /opt/caac/ipfs-repo
```

#### 备份 Fabric 证书

```bash
tar -czf /backup/fabric-crypto-$(date +%Y%m%d).tar.gz \
    /opt/caac/fabric-samples/test-network/organizations
```

#### 备份配置

```bash
cp /opt/caac/caac-env.sh /backup/caac-env-$(date +%Y%m%d).sh
```

### 10.4 日志轮转

创建 `/etc/logrotate.d/caac`：

```bash
sudo tee /etc/logrotate.d/caac > /dev/null <<'EOF'
/opt/caac/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 icenter icenter
    sharedscripts
    postrotate
        # 重新打开日志文件（如果使用 systemd 则不需要）
    endscript
}
EOF
```

### 10.5 监控

#### 健康检查脚本

```bash
cat > /opt/caac/health-check.sh <<'EOF'
#!/bin/bash

echo "=== Port Check ==="
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051' || echo "❌ Some ports not listening"

echo -e "\n=== Container Check ==="
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E "peer|orderer" || echo "❌ Fabric containers not running"

echo -e "\n=== API Check ==="
curl -sf http://127.0.0.1:5051/api/files/health > /dev/null && echo "✅ Gateway healthy" || echo "❌ Gateway unhealthy"
curl -sf -X POST http://127.0.0.1:5001/api/v0/version > /dev/null && echo "✅ IPFS healthy" || echo "❌ IPFS unhealthy"

echo -e "\n=== Disk Usage ==="
df -h /opt/caac

echo -e "\n=== Memory Usage ==="
free -h
EOF

chmod +x /opt/caac/health-check.sh
```

运行健康检查：

```bash
/opt/caac/health-check.sh
```

---

## 附录 A: 环境变量说明

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `CAAC_BASE_URL` | `http://10.216.217.146:5051` | Gateway 对外访问地址 |
| `CAAC_IPFS_API_URL` | `http://127.0.0.1:5001` | IPFS API 地址 |
| `CAAC_IPFS_GATEWAY_URL` | `http://127.0.0.1:8080/ipfs` | IPFS HTTP 网关 |
| `CAAC_IPFS_PATH` | `/opt/caac/ipfs-repo` | IPFS 数据目录 |
| `CAAC_FABRIC_CRYPTO_PATH` | `/opt/caac/fabric-samples/test-network/organizations/...` | Fabric 证书路径 |
| `CAAC_INITIAL_ADMIN_PASSWORD` | - | 管理员初始密码 |
| `CAAC_ORACLE_HMAC_KEY` | - | Oracle HMAC 密钥（64 字符 hex） |
| `CAAC_AUDIT_HMAC_KEY` | - | 审计 HMAC 密钥（64 字符 hex） |
| `CAAC_MAIL_USERNAME` | - | 邮箱用户名 |
| `CAAC_MAIL_PASSWORD` | - | 邮箱授权码 |
| `CAAC_HCAPTCHA_SITEKEY` | - | hCaptcha 站点密钥 |
| `CAAC_HCAPTCHA_SECRET` | - | hCaptcha 服务端密钥 |
| `CAAC_CAPTCHA_ENABLED` | `true` | 是否启用验证码 |
| `CAAC_CAPTCHA_PROVIDER` | `both` | 验证码提供商：`both`/`auto`/`math` |
| `CAAC_EMAIL_VERIFICATION_ENABLED` | `true` | 是否启用邮箱验证 |
| `CAAC_PHONE_VERIFICATION_ENABLED` | `false` | 是否启用手机验证 |
| `CAAC_ADMIN_APPROVAL_REQUIRED` | `false` | 是否需要管理员审批新用户 |
| `CAAC_CORS_ALLOWED_ORIGINS` | - | CORS 允许的源（逗号分隔） |
| `CAAC_FRONTEND_LOGIN_URL` | `http://10.216.217.146/icenter/login.html` | 前端登录页 URL |

---

## 附录 B: 端口映射

| 端口 | 协议 | 服务 | 绑定地址 | 说明 |
|------|------|------|----------|------|
| 5001 | HTTP | IPFS API | 127.0.0.1 | 仅本地访问 |
| 5050 | HTTP | Oracle | 127.0.0.1 | 仅本地访问（安全隔离） |
| 5051 | HTTP | Gateway | 0.0.0.0 | 对外提供 REST API |
| 7050 | gRPC | Orderer | 0.0.0.0 | Fabric 排序服务 |
| 7051 | gRPC | Peer (Org1) | 0.0.0.0 | Fabric 节点 |
| 8051 | gRPC | Peer (Org1) Operations | 0.0.0.0 | Peer 运维接口 |
| 9051 | gRPC | Peer (Org2) | 0.0.0.0 | Fabric 节点 |
| 8080 | HTTP | IPFS Gateway | 127.0.0.1 | IPFS HTTP 网关 |
| 9443 | HTTP | Peer Operations | 0.0.0.0 | Fabric 运维 API |

---

## 附录 C: 常用命令速查

```bash
# 启动所有服务
/opt/caac/start-all.sh

# 停止所有服务
/opt/caac/stop-all.sh

# 查看所有端口
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051'

# 查看所有容器
docker ps --format 'table {{.Names}}\t{{.Status}}'

# 查看日志
tail -f /opt/caac/logs/gateway.log
tail -f /opt/caac/logs/oracle.log
tail -f /opt/caac/logs/ipfs.log

# 测试 Gateway API
curl -s http://127.0.0.1:5051/api/files/health | jq

# 测试 IPFS
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq

# 重启 Fabric 网络
cd /opt/caac/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c mychannel -ca
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java

# 查看 chaincode 日志
docker logs -f $(docker ps -q --filter "name=dev-peer0.org1.example.com-caac")
```

---

**文档维护**: CAAC 项目组  
**技术支持**: [GitHub Issues](https://github.com/your-org/caac/issues)
