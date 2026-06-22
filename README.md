# FlexiGuard CAAC - 上下文感知访问控制系统

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Java](https://img.shields.io/badge/Java-17-orange.svg)
![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.2.0-brightgreen.svg)
![Hyperledger Fabric](https://img.shields.io/badge/Fabric-2.5-blue.svg)

**FlexiGuard CAAC (Context-Aware Access Control)** 是一个基于零信任架构的动态访问控制系统，采用区块链和IPFS技术实现细粒度的文件访问控制。系统通过多维上下文感知决策、BV-GCA风险预算算法和持续会话监控，实现自适应的安全访问控制。

---

## 📋 目录

- [系统特性](#系统特性)
- [系统架构](#系统架构)
- [核心算法](#核心算法)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [配置说明](#配置说明)
- [API文档](#api文档)
- [开发指南](#开发指南)
- [性能指标](#性能指标)
- [文档资源](#文档资源)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## ✨ 系统特性

### 核心功能

- **🔐 零信任架构**：三层架构（PDP-Oracle-PEP），无默认信任域
- **📊 17维上下文感知**：基于用户角色、信任值、位置、网络、设备、时间等17个参数的动态决策
- **🎯 BV-GCA窗口预算**：基于风险的分块传输控制，防止数据过度泄露
- **⚡ 实时撤销机制**：Algorithm 2后台监控，上下文降级自动撤销会话
- **🌐 集群风险传播（CSRP）**：子网风险传播机制，指数衰减模型
- **🔗 区块链存证**：Hyperledger Fabric不可篡改审计日志
- **📦 分布式存储**：IPFS内容寻址存储，AES-256-GCM加密
- **🚨 异常检测**：多维度行为分析，自动封禁机制
- **🔔 实时推送**：SSE事件流，实时监控系统状态

### 安全特性

- **密码安全**：BCrypt哈希（cost=12）+ 强密码策略
- **双因素认证**：TOTP（30秒时间窗口）
- **令牌安全**：JWT（HMAC-SHA256）+ HttpOnly Cookie
- **请求签名**：HMAC-SHA256防篡改，时间窗口验证
- **文件加密**：AES-256-GCM模式，密钥本地隔离存储
- **审计完整性**：HMAC签名 + 区块链双重保护

---

## 🏗️ 系统架构

### 三层零信任架构

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Vite)                       │
│  Dashboard │ File Manager │ Admin Panel │ Monitor       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS + JWT
┌────────────────────────┴────────────────────────────────┐
│              Layer 3: PEP (Gateway)                      │
│  Auth │ File Access │ Session Manager │ IPFS            │
└────────────────────────┬────────────────────────────────┘
                         │ HMAC Signed Request
┌────────────────────────┴────────────────────────────────┐
│              Layer 2: Oracle Service                     │
│  Context Resolution │ Algorithm 1 Evaluation            │
└────────────────────────┬────────────────────────────────┘
                         │ gRPC
┌────────────────────────┴────────────────────────────────┐
│         Layer 1: PDP (Fabric Smart Contract)            │
│  CAACContract │ CAAR Storage │ Audit Ledger             │
└─────────────────────────────────────────────────────────┘
```

### 数据流图

```
User Request → Gateway (Context Collection)
           ↓
       Oracle (17-Param Evaluation)
           ↓
    Fabric Chaincode (Algorithm 1)
           ↓
      Decision (PERMIT/DENY)
           ↓
    Session Registration
           ↓
 BV-GCA Streaming (Algorithm 2 Monitoring)
           ↓
    CAAR Blockchain Storage
```

---

## 🧮 核心算法

### Algorithm 1: 上下文感知访问决策

**17个上下文参数**：
- **用户维度**：R_sub（角色等级）, T_sub（信任值）, B_freq（行为频率）
- **环境维度**：L_trust（位置信任）, N_status（网络状态）, D_sec（设备安全）, T_req（时间约束）
- **对象维度**：S_level（敏感度）, P_req（阈值）, O_risk（对象风险）
- **交互维度**：R_interaction（风险交互项）

**决策公式**：
```
CE_score = (w1×L + w2×N + w3×D - δ×R_interaction) × T_req
DT_score = (α×T_sub + β×CE_score) × Φ(B_freq)
Decision = (R_sub ≥ S_level) AND (DT_score ≥ P_eff)
```

### Algorithm 2: 持续撤销检测

**后台定时监控**（每1秒触发）：
```
for each active_session:
    if (time_since_last_check ≥ Δt):
        new_DT = reevaluate_oracle()
        margin'' = (new_DT - P_eff) - η×R_N
        if margin'' < 0:
            revoke_session()
```

**自适应轮询间隔**：
- HIGH-RISK: Δt = 2秒
- MEDIUM-RISK: Δt = 3秒
- LOW-RISK: Δt = 4秒

### BV-GCA: 窗口预算算法

**公式**：
```
L(m, S, T_sub, n) = base_window × tier_multiplier × trust_factor × ψ(n)
```

**层级系数**：
- LOW-RISK: 1.5×
- MEDIUM-RISK: 1.0×
- HIGH-RISK: 0.5×

**加速因子**：
```
ψ(n) = 1 + 0.1 × min(n, 10)  // n为稳定计数，最大2.0倍加速
```

### CSRP: 集群风险传播

**子网风险计算**：
```
R_N(t) = Σ w(t - t_i)
w(Δt) = exp(-Δt / τ)  // τ = 3600秒
```

**阈值判断**：
- R_N ≥ 3.0 → 封锁子网24小时
- R_N < 3.0 → margin'' = margin - 0.2×R_N

---

## 🛠️ 技术栈

### 后端技术
- **框架**：Spring Boot 3.2.0
- **语言**：Java 17
- **区块链**：Hyperledger Fabric 2.5
- **存储**：IPFS (Kubo v0.32)
- **加密**：AES-256-GCM, BCrypt, HMAC-SHA256
- **构建工具**：Maven 3.9+

### 前端技术
- **构建工具**：Vite 5.4
- **可视化**：Chart.js 4.4
- **语言**：纯JavaScript (ES6+)
- **通信**：Fetch API, Server-Sent Events (SSE)

### 基础设施
- **容器**：Docker
- **编排**：Docker Compose
- **网络**：gRPC, REST API
- **数据库**：内存存储 + Fabric账本

---

## 🚀 快速开始

### 前置要求

- Java 17+
- Node.js 18+
- Docker & Docker Compose
- Maven 3.9+
- Go 1.21+ (Fabric链码编译)

### 1. 克隆项目

```bash
git clone https://github.com/yourusername/context-aware-access-control.git
cd context-aware-access-control
```

### 2. 启动Fabric网络

```bash
cd backend/fabric-samples/test-network
./network.sh up createChannel -c mychannel -ca
```

### 3. 部署智能合约

```bash
cd ../caac-chaincode
./gradlew installDist
cd ../test-network
./network.sh deployCC -ccn caac -ccp ../caac-chaincode -ccl java
```

### 4. 启动IPFS节点

```bash
ipfs init
ipfs daemon
```

### 5. 启动Oracle服务

```bash
cd backend/caac-oracle
mvn spring-boot:run
```

### 6. 启动Gateway服务

```bash
cd backend/caac-gateway
mvn spring-boot:run
```

### 7. 启动前端

```bash
cd frontend/caac-website
npm install
npm run dev
```

### 8. 访问系统

- **前端界面**：http://localhost:5173
- **Gateway API**：http://localhost:5051
- **Oracle API**：http://localhost:5050

### 默认管理员账户

```
用户名: admin
密码: Admin@123456
```

---

## 📁 项目结构

```
context-aware-access-control/
├── backend/
│   ├── caac-gateway/                 # Layer 3: PEP网关服务
│   │   ├── src/main/java/
│   │   │   └── org/example/gateway/
│   │   │       ├── controller/       # REST控制器
│   │   │       ├── service/          # 业务逻辑
│   │   │       ├── model/            # 数据模型
│   │   │       └── config/           # 配置类
│   │   ├── data/                     # 本地数据存储
│   │   └── pom.xml
│   │
│   ├── caac-oracle/                  # Layer 2: Oracle评估服务
│   │   ├── src/main/java/
│   │   │   └── org/example/oracle/
│   │   │       ├── controller/       # 评估控制器
│   │   │       ├── service/          # Fabric交互
│   │   │       └── config/           # Fabric配置
│   │   └── pom.xml
│   │
│   └── fabric-samples/               # Layer 1: Fabric网络
│       ├── test-network/             # 测试网络脚本
│       └── caac-chaincode/           # 智能合约
│           └── src/main/java/
│               └── org/example/caac/
│                   └── CAACContract.java  # Algorithm 1实现
│
├── frontend/
│   └── caac-website/                 # 前端Web应用
│       ├── src/
│       │   └── entries/              # 页面入口
│       ├── js/                       # 业务逻辑
│       ├── css/                      # 样式文件
│       ├── *.html                    # HTML页面
│       ├── vite.config.js            # Vite配置
│       └── package.json
│
├── benchmarks/                       # 性能测试脚本
│   ├── bvgca_attack_sim.py          # BV-GCA攻击模拟
│   └── test_attack_resilience.py    # 弹性测试
│
├── DOCS/                             # 文档目录
│   └── DOCS/
│       ├── 功能流程图.md             # 15个Mermaid流程图
│       ├── function_manual.md        # 功能说明书
│       ├── 模块与函数设计_精简版.md  # 模块设计文档
│       └── 文档创建总结报告.md       # 文档总结
│
└── README.md                         # 本文件
```

---

## ⚙️ 配置说明

### Gateway配置

**文件位置**：`backend/caac-gateway/src/main/resources/application.properties`

```properties
# 服务器配置
server.port=5051

# Oracle服务地址
caac.oracle.url=http://127.0.0.1:5050

# IPFS配置
caac.ipfs.api-url=http://127.0.0.1:5001
caac.ipfs.keys-path=data/ipfs_keys

# Fabric配置
caac.fabric.network-path=../fabric-samples/test-network
caac.fabric.channel=mychannel
caac.fabric.chaincode=caac

# 注册配置
caac.registration.require-email-verification=true
caac.registration.require-admin-approval=false

# 验证码配置
caac.captcha.type=math
caac.hcaptcha.secret-key=your-secret-key

# 邮件配置（可选）
spring.mail.host=smtp.gmail.com
spring.mail.port=587
spring.mail.username=your-email@gmail.com
spring.mail.password=your-app-password
```

### Oracle配置

**文件位置**：`backend/caac-oracle/src/main/resources/application.properties`

```properties
# 服务器配置
server.port=5050

# Fabric网络配置
fabric.network.path=../fabric-samples/test-network
fabric.channel.name=mychannel
fabric.chaincode.name=caac
```

---

## 📡 API文档

### 认证相关

| 方法 | 端点 | 描述 |
|-----|------|------|
| POST | `/api/auth/signup` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/setup-2fa` | 设置双因素认证 |
| POST | `/api/auth/verify-email` | 验证邮箱 |
| POST | `/api/auth/logout` | 退出登录 |

### 文件相关

| 方法 | 端点 | 描述 |
|-----|------|------|
| POST | `/api/files/upload` | 上传文件 |
| POST | `/api/files/access` | 请求文件访问 |
| GET | `/api/files/stream/{sessionId}` | 流式传输文件 |
| GET | `/api/files/list` | 获取文件列表 |
| GET | `/api/files/{id}` | 获取文件详情 |

### 管理相关

| 方法 | 端点 | 描述 |
|-----|------|------|
| GET | `/api/admin/users` | 用户列表 |
| PUT | `/api/admin/users/{id}/approve` | 审批用户 |
| GET | `/api/admin/files/pending` | 待审批文件 |
| PUT | `/api/admin/files/{id}/approve` | 审批文件 |
| POST | `/api/admin/users/{id}/block` | 封禁用户 |

### 监控相关

| 方法 | 端点 | 描述 |
|-----|------|------|
| GET | `/api/events/stream` | SSE事件流 |
| GET | `/api/sessions/active` | 活跃会话列表 |
| GET | `/api/audit/logs` | 审计日志 |
| GET | `/api/stats/overview` | 系统统计 |

**详细API文档**：请参考 `DOCS/DOCS/function_manual.md`

---

## 👨‍💻 开发指南

### 开发环境设置

1. **安装依赖**
```bash
# 后端
cd backend/caac-gateway
mvn install

# 前端
cd frontend/caac-website
npm install
```

2. **配置IDE**
- 推荐使用IntelliJ IDEA或Eclipse
- 导入Maven项目
- 配置JDK 17

3. **本地测试**
```bash
# 运行后端测试
mvn test

# 运行前端测试
npm test
```

### 代码规范

- **Java**：遵循Google Java Style Guide
- **JavaScript**：使用ESLint + Prettier
- **Git Commit**：遵循Conventional Commits

### 调试技巧

1. **查看Fabric日志**
```bash
docker logs peer0.org1.example.com
```

2. **查看IPFS状态**
```bash
ipfs id
ipfs swarm peers
```

3. **测试Oracle连接**
```bash
curl http://localhost:5050/api/health
```

---

## 📊 性能指标

- **并发会话**：支持1000+并发活跃会话
- **Oracle响应时间**：< 100ms
- **Fabric查询延迟**：< 50ms
- **IPFS上传速度**：平均5MB/s
- **流传输速率**：8KB分块，动态窗口控制
- **Algorithm 2轮询**：2-4秒自适应间隔
- **SSE推送延迟**：< 100ms

---

## 📚 文档资源

### 核心文档

- [功能流程图](DOCS/DOCS/功能流程图.md) - 15个详细的Mermaid流程图
- [功能说明书](DOCS/DOCS/function_manual.md) - 完整功能说明和API文档
- [模块与函数设计](DOCS/DOCS/模块与函数设计_精简版.md) - 10个核心模块设计
- [文档总结报告](DOCS/DOCS/文档创建总结报告.md) - 文档完成情况总结

### 算法说明

- **Algorithm 1**：上下文感知访问决策（17维参数）
- **Algorithm 2**：持续撤销检测（自适应轮询）
- **BV-GCA**：窗口预算算法（风险分层传输）
- **CSRP**：集群风险传播（指数衰减模型）

### 外部资源

- [Hyperledger Fabric文档](https://hyperledger-fabric.readthedocs.io/)
- [IPFS文档](https://docs.ipfs.tech/)
- [Spring Boot文档](https://spring.io/projects/spring-boot)

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献流程

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m ''Add some AmazingFeature''`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启Pull Request

### 代码审查

所有PR都需要通过：
- 代码审查
- 单元测试
- 集成测试
- 文档更新

---

## 📄 许可证

本项目采用 **MIT License** 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 👥 团队

**FlexiGuard CAAC项目组**

- 系统设计与架构
- 核心算法实现
- 前后端开发
- 测试与文档

---

## 📧 联系方式

- **项目主页**：https://github.com/yourusername/context-aware-access-control
- **问题反馈**：https://github.com/yourusername/context-aware-access-control/issues
- **邮箱**：your-email@example.com

---

## 🙏 致谢

感谢以下开源项目：
- Hyperledger Fabric
- IPFS
- Spring Boot
- Chart.js
- Vite

---

**⭐ 如果这个项目对您有帮助，请给我们一个Star！**
