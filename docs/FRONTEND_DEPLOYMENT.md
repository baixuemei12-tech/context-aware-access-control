# CAAC 前端部署文档

**版本**: 1.0
**适用环境**: Ubuntu 20.04 LTS
**部署路径**: `/opt/caac/front`
**前端源码**: `/data1/flexiguard/frontend/caac-website`
**构建工具**: Vite 5.x + Node.js 18/22
**Web 服务器**: nginx
**最后更新**: 2026-05-22

---

## 目录

1. [系统要求](#1-系统要求)
2. [目录与端口规划](#2-目录与端口规划)
3. [依赖安装](#3-依赖安装)
4. [前端构建](#4-前端构建)
5. [部署到 `/opt/caac/front`](#5-部署到-optcaacfront)
6. [nginx 站点配置](#6-nginx-站点配置)
7. [部署验证](#7-部署验证)
8. [更新与回滚](#8-更新与回滚)
9. [故障排查](#9-故障排查)
10. [HTTPS / 反向代理（可选）](#10-https--反向代理可选)

---

## 1. 系统要求

### 1.1 软件依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | 18.x 或 22.x | 构建前端 |
| npm | 9+ | 依赖管理 |
| Vite | 5.4.x | 构建器（项目 `devDependency`） |
| nginx | 1.18+ | 静态资源服务 + 反向代理 |

> 项目根 `package.json` 仅声明了 `chart.js` 与 `vite` 两项核心依赖，其余 (`esbuild`、`rollup` 等) 由 Vite 间接引入。

### 1.2 与后端的依赖关系

前端在浏览器侧通过 `GATEWAY_URL`（`js/common.js` 中解析）访问 Gateway 的 `/api/**` 接口。生产环境推荐让 nginx 把 `/api/` 反代到 `127.0.0.1:5051`，前端使用同源相对路径，从而：

- 不需要在前端文件里硬编码 `http://10.216.217.146:5051`；
- 不会触发跨域 / CORS 预检；
- 后续切换到 HTTPS / 域名只需改 nginx，不动前端。

---

## 2. 目录与端口规划

### 2.1 目录布局

```
/opt/caac/front/                       # 部署根（nginx root）
├── index.html
├── admin.html
├── login.html
├── messages.html
├── overview.html
├── profile.html
├── scenarios.html
└── assets/                            # Vite 构建产物（含哈希文件名）
    ├── index-XXXX.js
    ├── index-XXXX.css
    ├── admin-XXXX.js
    ├── login-XXXX.js
    ├── ...
    └── *.svg / *.woff2 等静态资源
```

构建产物均位于 `frontend/caac-website/dist/`，部署时整体复制到 `/opt/caac/front/`。

### 2.2 端口

| 端口 | 服务 | 暴露范围 |
|------|------|----------|
| 80 | nginx（站点入口） | `0.0.0.0` |
| 5051 | Gateway API | `127.0.0.1`（由 nginx 反代） |
| 443 | nginx HTTPS（可选） | `0.0.0.0` |

---

## 3. 依赖安装

### 3.1 Node.js 与 npm

推荐使用 NodeSource 仓库，避免 Ubuntu 自带版本过旧：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v        # 期望 v22.x（v18.x 也可）
npm -v         # 期望 9+
```

### 3.2 nginx

```bash
sudo apt-get install -y nginx
nginx -v
sudo systemctl enable --now nginx
```

---

## 4. 前端构建

### 4.1 关键文件说明

| 文件 | 作用 |
|------|------|
| `package.json` | 定义 `dev` / `build` / `preview` 脚本 |
| `vite.config.js` | 7 个入口（`index/admin/login/messages/overview/profile/scenarios`），`outDir=dist`，`base='./'` |
| `js/config.js` | 仅在 `localhost` / `127.0.0.1` 下覆盖 `window.CAAC_GATEWAY_URL=''` |
| `js/common.js` | 解析最终 `GATEWAY_URL`：自定义值 → `.trycloudflare.com` 直通 → 否则同源相对路径 |

> 因为 `common.js` 默认走"同源相对路径"，**生产环境只要 nginx 反代 `/api/` 就不需要替换任何 URL**。仅当你保留独立端口 5051 直连模式时，才需要把构建产物里残留的 `http://localhost:5051` 替换为 `http://10.216.217.146:5051`。

### 4.2 安装依赖

```bash
cd /data1/flexiguard/frontend/caac-website

# 推荐：使用 lockfile 严格安装
npm ci

# 如果没有 package-lock.json 或希望解析新版本
npm install
```

国内网络环境可加镜像：

```bash
npm config set registry https://registry.npmmirror.com
# 或单次：
npm install --registry=https://registry.npmmirror.com
```

### 4.3 解决 `esbuild EACCES` 错误

如果 `node_modules/` 是从其它机器（如 WSL）通过 `cp` / `scp` / `zip` 拷贝过来的，二进制可能丢失可执行位，安装时报：

```
spawnSync .../node_modules/esbuild/bin/esbuild EACCES
errno: -13, code: 'EACCES'
```

**根因**：`esbuild` 的 postinstall 校验脚本会 `spawnSync esbuild --version`，但目标二进制只有 `rw-`，没有 `x` 位。

**推荐解法（彻底重装）**：

```bash
cd /data1/flexiguard/frontend/caac-website
rm -rf node_modules package-lock.json   # package-lock.json 视情况保留
npm install
```

**临时解法（只补执行位）**：

```bash
cd /data1/flexiguard/frontend/caac-website
chmod +x node_modules/esbuild/bin/esbuild
chmod +x node_modules/@esbuild/linux-x64/bin/esbuild 2>/dev/null
chmod +x node_modules/.bin/* 2>/dev/null
node_modules/esbuild/bin/esbuild --version   # 应输出版本号
```

> 临时解法只修了 `esbuild`，`vite` / `rollup` 等其它二进制可能仍缺执行位，构建时还会再报 `EACCES`。**优先使用重装方案**。

### 4.4 执行构建

```bash
cd /data1/flexiguard/frontend/caac-website
npm run build         # 输出到 ./dist
ls -la dist/          # 应包含 7 个 html 与 assets/
```

构建产物体积通常 < 5 MB，可直接部署。

---

## 5. 部署到 `/opt/caac/front`

### 5.1 一次性创建目标目录

```bash
sudo mkdir -p /opt/caac/front
```

### 5.2 同步构建产物

```bash
cd /data1/flexiguard/frontend/caac-website

# 清理旧版本（保留 /opt/caac/front 本身，避免 nginx 路径失效）
sudo rm -rf /opt/caac/front/*

# 仅复制 dist 内容（不包含 dist 这一层目录）
sudo cp -a dist/. /opt/caac/front/
```

> 注意 `cp -a dist/.` 末尾的 `.` —— 它会把 `dist/` 内的所有文件（含点开头的隐藏文件）复制到 `/opt/caac/front/` 下，而不是再嵌套一层 `dist/`。

### 5.3 替换硬编码 API 地址（仅在不使用 nginx 反代时需要）

如果你**不**配置 nginx 反代 `/api/`，前端必须直连 Gateway 的 `5051` 端口，构建产物中可能残留开发用的 `localhost:5051`：

```bash
sudo grep -rl "http://localhost:5051" /opt/caac/front \
  | xargs -r sudo sed -i "s#http://localhost:5051#http://10.216.217.146:5051#g"
```

> Vite 把所有逻辑打包进 `assets/*.js`（带哈希文件名），不存在 `js/common.js` 这种固定路径——必须用 `grep -rl | xargs sed` 递归替换 HTML/JS/CSS。

### 5.4 修正属主与权限

```bash
sudo chown -R www-data:www-data /opt/caac/front
sudo find /opt/caac/front -type d -exec chmod 755 {} \;
sudo find /opt/caac/front -type f -exec chmod 644 {} \;
```

> 用 `cp -a` 会保留源文件的属主（通常是开发用户 `icenter`），nginx 以 `www-data` 运行时可能因祖先目录无 `x` 权限而 `403`。这一步是必须的。

---

## 6. nginx 站点配置

### 6.1 站点配置文件

```bash
sudo tee /etc/nginx/sites-available/caac-front >/dev/null <<'EOF'
server {
    listen 80;
    server_name 10.216.217.146;

    root /opt/caac/front;
    index index.html;

    # 前端静态资源 + SPA 回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 反代 Gateway API：避免硬编码端口、消除跨域
    location /api/ {
        proxy_pass http://127.0.0.1:5051/api/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        client_max_body_size 400m;     # 与 Gateway multipart 上限对齐
    }

    # 静态资源缓存（带哈希文件名，可放心长缓存）
    location ~* ^/assets/.*\.(js|css|svg|woff2?|png|jpg|gif|ico)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF
```

### 6.2 启用站点

```bash
sudo ln -sfn /etc/nginx/sites-available/caac-front /etc/nginx/sites-enabled/caac-front

# 如果与默认 default 站点冲突（80 端口被占）
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
```

### 6.3 与后端对齐 CORS（可选）

启用 nginx 反代后，前端走同源 `/api/`，**Gateway 端 CORS 不会触发**，无需调整。如果你保留独立端口 5051 直连模式，确保 `caac-env.sh` 中：

```bash
export CAAC_CORS_ALLOWED_ORIGINS='http://10.216.217.146,http://10.216.217.146:5052,...'
```

包含浏览器实际访问的源（含端口、协议）。

---

## 7. 部署验证

```bash
# 1. nginx 进程在线，监听 80
ss -ltnp | grep ':80'

# 2. 站点根可访问
curl -I http://10.216.217.146/
# 期望：HTTP/1.1 200 OK，Content-Type: text/html

# 3. 静态入口存在
curl -s -o /dev/null -w '%{http_code}\n' http://10.216.217.146/login.html
curl -s -o /dev/null -w '%{http_code}\n' http://10.216.217.146/admin.html
# 期望：均为 200

# 4. /api/ 反代到 Gateway
curl -sS http://10.216.217.146/api/auth/captcha-config
# 期望：返回 JSON，字段含 enabled / provider 等

# 5. 浏览器实际访问（外部机器）
# http://10.216.217.146/             → 自动跳到 index.html
# http://10.216.217.146/login.html   → 登录页可加载，CAPTCHA 正常出现
```

如果浏览器控制台仍出现 `Mixed Content` 或 CORS 错误，多半是步骤 5.3 没替换或 nginx 没 reload，回看 [4.1](#41-关键文件说明) 与 [6.2](#62-启用站点)。

---

## 8. 更新与回滚

### 8.1 滚动更新

```bash
cd /data1/flexiguard/frontend/caac-website
git pull            # 或其它同步源码方式
npm ci
npm run build

# 备份当前版本
sudo mv /opt/caac/front /opt/caac/front.bak.$(date +%Y%m%d_%H%M%S)

# 部署新版本
sudo mkdir -p /opt/caac/front
sudo cp -a dist/. /opt/caac/front/
sudo chown -R www-data:www-data /opt/caac/front
sudo find /opt/caac/front -type d -exec chmod 755 {} \;
sudo find /opt/caac/front -type f -exec chmod 644 {} \;

sudo nginx -t && sudo systemctl reload nginx
```

> nginx `reload` 不会断开已建立的连接，热更新无停机。

### 8.2 快速回滚

```bash
# 列出可用备份
ls -d /opt/caac/front.bak.*

# 恢复到指定备份
sudo rm -rf /opt/caac/front
sudo mv /opt/caac/front.bak.20260520_143000 /opt/caac/front
sudo systemctl reload nginx
```

### 8.3 清理旧备份（保留最近 3 份）

```bash
ls -1dt /opt/caac/front.bak.* | tail -n +4 | xargs -r sudo rm -rf
```

---

## 9. 故障排查

### 9.1 常见问题速查

| 现象 | 可能原因 | 处置 |
|------|----------|------|
| `403 Forbidden` 访问首页 | nginx 用户对 `/opt/caac/front` 无 `r-x` 权限 | 重做 [5.4](#54-修正属主与权限) |
| `404 Not Found` 刷新子页面 | 缺少 SPA 回退 | 确认 `try_files $uri $uri/ /index.html;` |
| 浏览器报 CORS 错误 | 未启用反代且 `CAAC_CORS_ALLOWED_ORIGINS` 不含当前 origin | 启用 nginx `/api/` 反代或扩 origin |
| `502 Bad Gateway` 调 `/api/` | Gateway 未启动 / 不在 5051 | `ss -ltnp \| grep 5051` 检查 |
| `npm install` 报 `EACCES esbuild` | `node_modules` 二进制丢失执行位 | 见 [4.3](#43-解决-esbuild-eacces-错误) |
| `npm run build` 报 `permission denied vite` | 同上 | `chmod +x node_modules/.bin/*` 或重装 |
| 上传大文件 `413 Payload Too Large` | nginx `client_max_body_size` 默认 1m | 站点配置中改为 `400m`（已给出） |
| 页面白屏，控制台 404 加载 `/assets/...` | `dist` 复制不完整 | 重做 [5.2](#52-同步构建产物) |

### 9.2 日志位置

```bash
# nginx 访问 / 错误日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# 单独站点日志（可在 server 块加 access_log/error_log 指定）
```

### 9.3 配置语法检查

```bash
sudo nginx -t                        # 语法 + 文件路径
sudo nginx -T | sed -n '/caac-front/,/^}/p'   # 打印实际生效的站点
```

---

## 10. HTTPS / 反向代理（可选）

### 10.1 使用 Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain.example.com
```

certbot 会自动改写 `caac-front` 站点为 443 监听并配置证书自动续期。

### 10.2 同步更新后端环境

```bash
# 修改 /opt/caac/caac-env.sh
export CAAC_BASE_URL='https://your.domain.example.com'
export CAAC_CORS_ALLOWED_ORIGINS='https://your.domain.example.com'

# 重启 Gateway 使变量生效
sudo systemctl restart caac-gateway   # 或 ./restart-gateway.sh
```

### 10.3 调整 CSP

`SecurityHeadersFilter.java` 中的 `Content-Security-Policy` `connect-src` 默认含 `http://10.216.217.146:5051`，HTTPS 部署后需追加 `https://your.domain.example.com:443` 后**重新构建并部署 Gateway JAR**，前端自身无需调整。

---

## 附录：一键部署脚本（参考）

将以下脚本保存为 `/opt/caac/scripts/deploy-front.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="/data1/flexiguard/frontend/caac-website"
DST_DIR="/opt/caac/front"
BACKUP_DIR="/opt/caac/front.bak.$(date +%Y%m%d_%H%M%S)"

cd "$SRC_DIR"

echo "[1/5] 安装依赖"
npm ci

echo "[2/5] 构建"
npm run build

echo "[3/5] 备份现有部署"
if [ -d "$DST_DIR" ]; then
  sudo mv "$DST_DIR" "$BACKUP_DIR"
fi
sudo mkdir -p "$DST_DIR"

echo "[4/5] 同步产物 + 修权限"
sudo cp -a dist/. "$DST_DIR"/
sudo chown -R www-data:www-data "$DST_DIR"
sudo find "$DST_DIR" -type d -exec chmod 755 {} \;
sudo find "$DST_DIR" -type f -exec chmod 644 {} \;

echo "[5/5] 重载 nginx"
sudo nginx -t
sudo systemctl reload nginx

# 仅保留最近 3 份备份
ls -1dt /opt/caac/front.bak.* 2>/dev/null | tail -n +4 | xargs -r sudo rm -rf

echo "完成：$DST_DIR"
```

```bash
sudo chmod +x /opt/caac/scripts/deploy-front.sh
/opt/caac/scripts/deploy-front.sh
```

— 文档结束 —
