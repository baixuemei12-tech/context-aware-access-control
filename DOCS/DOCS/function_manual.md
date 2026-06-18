# FlexiGuard 上下文感知访问控制系统 - 功能说明书

**版本**: V1.0  
**日期**: 2026-06-18  
**项目组**: FlexiGuard CAAC

---

## 系统概述

FlexiGuard上下文感知访问控制系统(CAAC)是一个基于区块链和IPFS的动态访问控制系统，采用零信任架构，结合Hyperledger Fabric智能合约实现细粒度的文件访问控制。系统通过BV-GCA风险预算算法和实时上下文评估，动态调整访问权限，支持实时撤销和异常检测。

### 系统架构

- **Layer 1 (PDP)**: Hyperledger Fabric智能合约 - 策略决策点
- **Layer 2 (Oracle)**: 上下文收集与评估服务
- **Layer 3 (PEP)**: Gateway网关 - 策略执行点

### 技术栈

- **后端**: Spring Boot 3.2, Java 17, Hyperledger Fabric 2.5
- **前端**: Vite 5.4 + Chart.js, 纯JavaScript
- **存储**: IPFS (Kubo v0.32), Fabric区块链账本
- **加密**: AES-256-GCM, BCrypt, HMAC-SHA256

---

## 主要功能列表

### 一、用户认证与授权
1. 用户注册（验证码、邮箱验证、管理员审批）
2. 用户登录（密码认证、2FA、自适应验证码）
3. 双因素认证设置（TOTP）
4. 邮箱验证
5. 密码重置

### 二、文件访问控制
1. 上下文感知访问决策（Algorithm 1, 17维参数）
2. 文件流式传输（BV-GCA窗口预算）
3. 持续撤销检测（Algorithm 2）
4. 会话管理

### 三、文件管理
1. 文件上传（AES-256加密 + IPFS）
2. 文件审批
3. 权限管理
4. 文件元数据管理

### 四、风险管理
1. 风险预算管理（BV-GCA算法）
2. 集群风险传播（CSRP）
3. 异常行为检测
4. 用户封禁

### 五、实时监控与审计
1. 实时事件推送（SSE）
2. 会话监控
3. 审计日志（HMAC保护）
4. 区块链存证

### 六、管理后台
1. 用户管理
2. 文件审批管理
3. 系统监控
4. 统计报表

---

## 功能详细说明

所有功能的详细流程图请参见 **《功能流程图.md》** 文档

### 核心算法

#### Algorithm 1: 上下文感知访问决策

**输入**: 17个上下文参数
**输出**: PERMIT/DENY决策 + DT_score + CE_score

**关键步骤**:
1. 计算R_interaction = max(0, (1-D_sec)×N_status)
2. 计算CE_score = (w1×L + w2×N + w3×D - δ×R_interaction)×T_req
3. 计算Φ(B_freq) = exp(-B_freq/τ)
4. 计算DT_score = (α×T_sub + β×CE_score)×Φ
5. 判断: R_sub≥S_level AND DT_score≥P_eff

#### Algorithm 2: 持续撤销检测

**功能**: 后台定时任务监控活跃会话上下文变化

**执行频率**: 每1秒触发，自适应轮询间隔2-4秒

**关键逻辑**:
1. 遍历所有活跃会话
2. 重新评估Oracle获取最新DT_score
3. 计算风险余量: margin = DT - P_eff
4. CSRP调整: margin' = margin - η×R_N
5. 如果margin'<0，撤销会话
6. 更新轮询间隔（HIGH-RISK=2s, MED=3s, LOW=4s）

#### BV-GCA: 窗口预算算法

**公式**: L(m, S, T_sub, n) = base_window × tier_multiplier × trust_factor × acceleration_factor

**窗口预算计算**:
- LOW-RISK: 1MB × 1.5 × T_sub × ψ(n)
- MEDIUM-RISK: 1MB × 1.0 × T_sub × ψ(n)
- HIGH-RISK: 1MB × 0.5 × T_sub × ψ(n)

**加速因子**: ψ(n) = 1 + 0.1×min(n, 10)，最大2.0倍

#### CSRP: 集群风险传播

**公式**: R_N(t) = Σ w(t - t_i)，其中w(Δt) = exp(-Δt/τ)

**衰减常数**: τ = 3600秒（1小时）

**阈值判断**:
- R_N ≥ 3.0: 封锁子网24小时
- R_N < 3.0: 传播风险，调整margin' = margin - 0.2×R_N

---

## 数据字典

### 用户表 (User)

| 字段 | 类型 | 说明 |
|------|------|------|
| userId | String | 用户唯一标识 |
| username | String | 用户名 |
| passwordHash | String | BCrypt哈希值 |
| displayName | String | 显示名称 |
| email | String | 电子邮箱 |
| role | Integer | 角色等级(R_sub: 1-5) |
| trustScore | Double | 信任值(T_sub: 0.0-1.0) |
| status | Enum | 状态(ACTIVE/PENDING/BLOCKED) |
| has2FA | Boolean | 是否启用2FA |
| totpSecret | String | TOTP密钥 |

### 文件表 (FileEntry)

| 字段 | 类型 | 说明 |
|------|------|------|
| fileId | String | 文件唯一标识 |
| fileName | String | 原始文件名 |
| cid | String | IPFS内容标识符 |
| sLevel | Integer | 敏感度级别(1-5) |
| uploadedBy | String | 上传用户ID |
| size | Long | 文件大小(字节) |
| uploadedAt | Long | 上传时间戳 |
| status | Enum | 状态(PENDING/APPROVED/REJECTED) |
| isEncrypted | Boolean | 是否加密 |

### 会话表 (AccessSession)

| 字段 | 类型 | 说明 |
|------|------|------|
| sessionId | String | 会话标识 |
| userId | String | 用户ID |
| fileId | String | 文件ID |
| dtScore | Double | 动态信任评分 |
| riskTier | Enum | 风险层级 |
| createdAt | Long | 创建时间 |
| lastCheckAt | Long | 最后检查时间 |
| wasRevoked | Boolean | 是否已撤销 |
| deliveredBytes | Long | 已传输字节数 |
| windowRemaining | Integer | 窗口剩余量 |
| stableCount | Integer | 稳定计数(n) |

---

## 安全机制

### 1. 密码安全
- BCrypt哈希算法，cost=12
- 强密码策略：8位以上，大小写字母+数字+符号
- 账户锁定：5次失败锁定30分钟

### 2. 令牌安全
- JWT令牌，HMAC-SHA256签名
- HttpOnly Cookie防XSS
- SameSite=Strict防CSRF
- 有效期24小时

### 3. 文件安全
- AES-256-GCM加密
- 密钥本地存储
- IPFS内容寻址
- 访问权限控制

### 4. 通信安全
- HMAC-SHA256请求签名
- 时间窗口验证±5分钟
- 防重放攻击（nonce）

### 5. 审计安全
- HMAC完整性保护
- 区块链不可篡改存证
- 日志轮转（5MB）

---

## 性能参数

- **并发会话**: 支持1000+并发活跃会话
- **Oracle响应**: <100ms
- **Fabric查询**: <50ms
- **IPFS上传**: 取决于文件大小，平均5MB/s
- **流传输**: 8KB分块，窗口预算控制吞吐量
- **Algorithm 2轮询**: 1-4秒自适应
- **SSE推送延迟**: <100ms

---

## 配置说明

主要配置文件: `application.properties`

```properties
# 服务器端口
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
caac.hcaptcha.secret-key=your-secret

# 邮件配置
spring.mail.host=smtp.gmail.com
spring.mail.port=587
spring.mail.username=your-email
spring.mail.password=your-password
```

---

## API端点

### 认证相关
- POST /api/auth/signup - 用户注册
- POST /api/auth/login - 用户登录
- POST /api/auth/setup-2fa - 设置2FA
- POST /api/auth/logout - 退出登录

### 文件相关
- POST /api/files/upload - 上传文件
- POST /api/files/access - 请求访问
- GET /api/files/stream/{sessionId} - 流式传输
- GET /api/files/list - 文件列表

### 管理相关
- GET /api/admin/users - 用户列表
- PUT /api/admin/users/{id}/approve - 审批用户
- GET /api/admin/files/pending - 待审批文件
- PUT /api/admin/files/{id}/approve - 审批文件

### 监控相关
- GET /api/events/stream - SSE事件流
- GET /api/sessions/active - 活跃会话列表
- GET /api/audit/logs - 审计日志

---

**文档结束**

完整的流程图请参见 **《功能流程图.md》**
