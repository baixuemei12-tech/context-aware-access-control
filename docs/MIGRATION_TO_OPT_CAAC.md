# CAAC 系统迁移文档：从 /data2/meeoree-test 到 /opt/caac

**迁移日期**: 2026-05-22  
**目标**: 将 CAAC 系统从 `/data2/meeoree-test/` 迁移到标准系统目录 `/opt/caac/`，保留旧目录中的非运行时文件（caliper、website 备份等）

---

## 1. 迁移前准备

### 1.1 确认当前环境

```bash
# 检查运行中的服务
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051|:9443'
ps aux | grep -E "ipfs|java.*caac" | grep -v grep
docker ps | grep -iE "peer|orderer|fabric"

# 检查 systemd 服务
systemctl list-units --type=service 'caac-*'
```

### 1.2 路径映射表

| 旧路径 | 新路径 | 说明 |
|--------|--------|------|
| `/data2/meeoree-test/bin/ipfs` | `/opt/caac/bin/ipfs` | IPFS 二进制 |
| `/data2/meeoree-test/ipfs-repo` | `/opt/caac/ipfs-repo` | IPFS 数据仓库 |
| `/data2/meeoree-test/fabric-samples/` | `/opt/caac/fabric-samples` → `/data1/flexiguard/backend/fabric-samples` | Fabric 工具链（软链） |
| `/data2/meeoree-test/caac-oracle/target/*.jar` | `/opt/caac/caac-oracle/target/*.jar` | Oracle JAR |
| `/data2/meeoree-test/caac-gateway/target/*.jar` | `/opt/caac/caac-gateway/target/*.jar` | Gateway JAR |
| `/data2/meeoree-test/caac-env.sh` | `/opt/caac/caac-env.sh` | 环境变量配置 |
| `/home/meeoree/fabric-samples/test-network` | ~~删除~~（改用环境变量） | Oracle 旧硬编码路径 |

---

## 2. 停止所有服务

### 2.1 停止 systemd 管理的 IPFS

```bash
sudo systemctl stop caac-ipfs.service
sudo systemctl disable caac-ipfs.service
systemctl is-active caac-ipfs.service   # 期望: inactive
```

### 2.2 停止 Oracle 和 Gateway

```bash
kill $(lsof -t -i:5051) $(lsof -t -i:5050) 2>/dev/null
sleep 2
```

### 2.3 停止 Fabric 网络

```bash
cd /data2/meeoree-test/fabric-samples/test-network
./network.sh down -i 2.5.12 -cai 1.5.15
```

### 2.4 验证所有服务已停止

```bash
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051|:9443'
docker ps | grep -iE "peer|orderer|fabric"
# 期望：两条命令都无输出
```

---

## 3. 创建新目录结构

```bash
sudo mkdir -p /opt/caac/{bin,ipfs-repo,caac-oracle/target,caac-gateway/target,logs}
sudo chown -R icenter:icenter /opt/caac
```

---

## 4. 迁移组件

### 4.1 IPFS

#### 拷贝二进制

```bash
cp /data2/meeoree-test/bin/ipfs /opt/caac/bin/ipfs
chmod +x /opt/caac/bin/ipfs
/opt/caac/bin/ipfs version   # 验证 v0.32.1
```

#### 拷贝 repo（保留已有 CID）

```bash
cp -a /data2/meeoree-test/ipfs-repo/. /opt/caac/ipfs-repo/

# 验证
ls /opt/caac/ipfs-repo/
# 期望看到: blocks  config  datastore  keystore  version
```

#### 配置 API 和 Gateway 地址

```bash
export IPFS_PATH=/opt/caac/ipfs-repo
/opt/caac/bin/ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
/opt/caac/bin/ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
```

### 4.2 Fabric

使用软链指向 `/data1/flexiguard/backend/fabric-samples`（已包含完整的 bin、config、test-network、chaincode）：

```bash
ln -sfn /data1/flexiguard/backend/fabric-samples /opt/caac/fabric-samples

# 修复脚本权限
sudo chown -R icenter:icenter /opt/caac/fabric-samples/test-network/
find /opt/caac/fabric-samples/test-network -type f -name "*.sh" -exec chmod +x {} +
```

### 4.3 重新编译 JAR

#### Oracle

```bash
cd /data1/flexiguard/backend/caac-oracle
./mvnw -DskipTests clean package
# 产物: target/demo-0.0.1-SNAPSHOT.jar

cp target/demo-0.0.1-SNAPSHOT.jar /opt/caac/caac-oracle/target/
```

#### Gateway

```bash
cd /data1/flexiguard/backend/caac-gateway
./mvnw -DskipTests clean package
# 产物: target/caac-gateway-1.0-SNAPSHOT.jar

cp target/caac-gateway-1.0-SNAPSHOT.jar /opt/caac/caac-gateway/target/
```

### 4.4 环境变量配置

```bash
cp /data1/flexiguard/caac-env.sh /opt/caac/caac-env.sh
```

确认 `/opt/caac/caac-env.sh` 包含以下关键配置：

```bash
# IPFS
export CAAC_IPFS_PATH='/opt/caac/ipfs-repo'
export CAAC_IPFS_API_URL='http://127.0.0.1:5001'
export CAAC_IPFS_GATEWAY_URL='http://127.0.0.1:8080/ipfs'

# Fabric crypto 路径（替代旧的 /home/meeoree 硬编码）
export CAAC_FABRIC_CRYPTO_PATH='/opt/caac/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'

# 其他配置（HMAC keys、邮箱、验证码等）保持不变
```

---

## 5. 启动新环境

### 5.1 设置环境变量

```bash
cd /opt/caac
source ./caac-env.sh

export PATH=/opt/caac/bin:/opt/caac/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/opt/caac/fabric-samples/config
export CONTAINER_CLI=docker
export CONTAINER_CLI_COMPOSE=docker-compose
```

### 5.2 启动 Fabric 网络

```bash
cd /opt/caac/fabric-samples/test-network

# 启动网络并创建通道
./network.sh up createChannel -c mychannel -ca -i 2.5.12 -cai 1.5.15

# 部署 chaincode
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java

# 验证
docker ps | grep -iE "peer|orderer"
ss -ltnp | grep -E ':7050|:7051'
```

### 5.3 启动 IPFS

```bash
cd /opt/caac
export IPFS_PATH=/opt/caac/ipfs-repo
rm -f "$IPFS_PATH/repo.lock"

nohup env IPFS_PATH="$IPFS_PATH" /opt/caac/bin/ipfs daemon --offline \
    > /opt/caac/logs/ipfs.log 2>&1 &

sleep 5

# 验证
curl -sS -X POST http://127.0.0.1:5001/api/v0/version
ss -ltnp | grep ':5001'
```

### 5.4 启动 Oracle

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

### 5.5 启动 Gateway

```bash
cd /opt/caac

nohup bash -lc 'cd /opt/caac; source caac-env.sh; \
    java -jar caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar' \
    > /opt/caac/logs/gateway.log 2>&1 &

sleep 5

# 验证
ss -ltnp | grep ':5051'
curl -s http://127.0.0.1:5051/api/auth/captcha-config
curl -s http://127.0.0.1:5051/api/files/health
```

---

## 6. 验证部署

### 6.1 端口检查

```bash
ss -ltnp | grep -E ':5001|:5050|:5051|:7050|:7051|:9443'
```

期望输出：
- `:5001` — IPFS API (ipfs daemon)
- `:5050` — Oracle (java)
- `:5051` — Gateway (java)
- `:7050` — Orderer
- `:7051` — Peer
- `:9443` — Peer operations

### 6.2 API 端点测试

```bash
# Gateway 健康检查
curl -s http://127.0.0.1:5051/api/files/health | jq

# IPFS 版本
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq

# Captcha 配置
curl -s http://127.0.0.1:5051/api/auth/captcha-config | jq
```

### 6.3 Oracle 隔离验证（安全检查）

```bash
# Oracle 不应对外暴露（期望：Connection refused）
curl -s http://10.216.217.146:5050/api/access/evaluate -X POST -d '{}' --connect-timeout 3
```

### 6.4 前端访问

浏览器访问：
- 登录页：`http://10.216.217.146/icenter/login.html`
- 管理后台：`http://10.216.217.146/icenter/admin.html`

默认管理员账号：
- 用户名：`admin`
- 密码：`caac-env.sh` 中的 `CAAC_INITIAL_ADMIN_PASSWORD`

---

## 7. 配置 systemd 服务（可选）

### 7.1 IPFS 服务

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

ExecStartPre=/bin/bash -lc 'mkdir -p "$IPFS_PATH"; [ -f "$IPFS_PATH/config" ] || /opt/caac/bin/ipfs init'
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
sudo systemctl status caac-ipfs.service
```

### 7.2 Oracle 服务

```bash
sudo tee /etc/systemd/system/caac-oracle.service > /dev/null <<'EOF'
[Unit]
Description=CAAC Oracle Service
After=network.target
Requires=caac-ipfs.service

[Service]
Type=simple
User=icenter
Group=icenter
WorkingDirectory=/opt/caac
EnvironmentFile=/opt/caac/caac-env.sh

ExecStart=/usr/bin/java -jar /opt/caac/caac-oracle/target/demo-0.0.1-SNAPSHOT.jar
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

### 7.3 Gateway 服务

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
EnvironmentFile=/opt/caac/caac-env.sh

ExecStart=/usr/bin/java -jar /opt/caac/caac-gateway/target/caac-gateway-1.0-SNAPSHOT.jar
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

---

## 8. 清理旧目录

**⚠️ 警告：确认新环境完全正常后再执行此步骤**

### 8.1 仅删除 CAAC 运行时文件

```bash
# 验证新环境正常运行
ss -ltnp | grep -E ':5001|:5050|:5051'
curl -s http://127.0.0.1:5051/api/files/health

# 删除旧运行时文件（保留 caliper、website 备份等）
rm -rf /data2/meeoree-test/bin
rm -rf /data2/meeoree-test/ipfs-repo
rm -rf /data2/meeoree-test/fabric-samples
rm -f  /data2/meeoree-test/caac-env.sh
rm -f  /data2/meeoree-test/caac-env.server.template.sh
rm -rf /data2/meeoree-test/caac-oracle/target
rm -rf /data2/meeoree-test/caac-gateway/target

# 可选：删除 Fabric 二进制副本（如果不再需要）
rm -rf /data2/meeoree-test/fabric-bin-good
rm -rf /data2/meeoree-test/fabric-bin-u20-2.5.12
rm -rf /data2/meeoree-test/caac-offline
```

### 8.2 保留的文件

以下文件/目录保留在 `/data2/meeoree-test/`：
- `caac-caliper/` — 性能测试工具
- `caac-website*` — 网站备份
- `debs/` — 离线 deb 包
- `cloudflared` — Cloudflare tunnel 工具
- `benchmarks/` — 基准测试数据

---

## 9. 关键变更说明

### 9.1 Oracle 路径配置变更

**旧方式**（硬编码 + 软链）：
- `application.properties` 默认值：`/home/meeoree/fabric-samples/test-network/...`
- 依赖软链：`/home/meeoree/fabric-samples/test-network` → `/data2/meeoree-test/fabric-samples/test-network`

**新方式**（环境变量）：
- 在 `caac-env.sh` 中设置：
  ```bash
  export CAAC_FABRIC_CRYPTO_PATH='/opt/caac/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'
  ```
- `application.properties` 读取：`fabric.cryptoPath = ${CAAC_FABRIC_CRYPTO_PATH}`
- 无需软链，更灵活

### 9.2 IPFS repo 迁移

- 旧 repo 数据完整拷贝，保留所有已上传文件的 CID
- 如需全新 repo（丢失旧 CID），改用：
  ```bash
  export IPFS_PATH=/opt/caac/ipfs-repo
  /opt/caac/bin/ipfs init
  ```

### 9.3 Fabric 网络重建

- 执行 `./network.sh down` 会清空账本数据
- 这是一次**重新部署**，不是**热迁移**
- 所有链上数据需重新提交

---

## 10. 故障排查

### 10.1 Oracle 启动失败：找不到 crypto 路径

**错误日志**：
```
Caused by: java.nio.file.NoSuchFileException: /home/meeoree/fabric-samples/test-network/...
```

**解决方案**：
1. 确认 `CAAC_FABRIC_CRYPTO_PATH` 已设置：
   ```bash
   echo $CAAC_FABRIC_CRYPTO_PATH
   ```
2. 确认路径存在：
   ```bash
   ls "$CAAC_FABRIC_CRYPTO_PATH/users/User1@org1.example.com/msp/signcerts/"
   ```
3. 启动时必须先 `source caac-env.sh`

### 10.2 IPFS 启动后立即退出

**错误日志**：
```
Error: no IPFS repo found in /opt/caac/ipfs-repo.
```

**解决方案**：
1. 检查 repo 是否拷贝成功：
   ```bash
   ls /opt/caac/ipfs-repo/
   ```
2. 如果为空，重新拷贝或初始化：
   ```bash
   cp -a /data2/meeoree-test/ipfs-repo/. /opt/caac/ipfs-repo/
   # 或
   export IPFS_PATH=/opt/caac/ipfs-repo
   /opt/caac/bin/ipfs init
   ```

### 10.3 Gateway 无法连接 Oracle

**检查**：
1. Oracle 是否在 `:5050` 监听：
   ```bash
   ss -ltnp | grep ':5050'
   ```
2. Gateway 配置的 Oracle URL：
   ```bash
   grep ORACLE /opt/caac/caac-env.sh
   ```

### 10.4 systemd 服务无法读取环境变量

**问题**：`EnvironmentFile=/opt/caac/caac-env.sh` 不支持 `export` 语法

**解决方案**：
- 方案 A：在 service 文件中用 `Environment=` 逐行列出
- 方案 B：用 `ExecStart=/bin/bash -lc 'source /opt/caac/caac-env.sh && java -jar ...'`

---

## 11. 附录

### 11.1 完整启动脚本

创建 `/opt/caac/start-all.sh`：

```bash
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
```

```bash
chmod +x /opt/caac/start-all.sh
```

### 11.2 完整停止脚本

创建 `/opt/caac/stop-all.sh`：

```bash
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
```

```bash
chmod +x /opt/caac/stop-all.sh
```

---

## 12. 迁移检查清单

- [ ] 旧服务全部停止（IPFS、Oracle、Gateway、Fabric）
- [ ] `/opt/caac/` 目录结构创建完成
- [ ] IPFS 二进制和 repo 已拷贝
- [ ] Fabric 软链已创建并验证
- [ ] Oracle 和 Gateway JAR 已重新编译并拷贝
- [ ] `caac-env.sh` 已更新 `CAAC_FABRIC_CRYPTO_PATH` 和 `CAAC_IPFS_PATH`
- [ ] Fabric 网络启动成功（peer、orderer、chaincode 容器运行中）
- [ ] IPFS daemon 监听 `:5001`
- [ ] Oracle 监听 `:5050`
- [ ] Gateway 监听 `:5051`
- [ ] API 端点测试通过（health、captcha-config、IPFS version）
- [ ] 前端登录测试通过
- [ ] systemd 服务配置完成（可选）
- [ ] 旧目录清理完成（仅删除运行时文件）

---

**文档版本**: 1.0  
**最后更新**: 2026-05-22  
**维护者**: CAAC 项目组
