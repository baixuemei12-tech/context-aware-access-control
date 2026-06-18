#!/usr/bin/env python3
"""
Generate 说明书.docx — Software Copyright Application Document
for CAAC (Context-Aware Access Control) System
"""

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn
import os

doc = Document()

# ============================================================
# Page Setup
# ============================================================
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.left_margin = Cm(2.5)
section.right_margin = Cm(2.5)
section.top_margin = Cm(2.0)
section.bottom_margin = Cm(2.0)

# ============================================================
# Style Configuration
# ============================================================
style = doc.styles['Normal']
font = style.font
font.name = '宋体'
font.size = Pt(12)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

# Helper functions
def add_heading_custom(text, level=1):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0, 0, 0)
        if level == 1:
            run.font.size = Pt(16)
        elif level == 2:
            run.font.size = Pt(14)
        elif level == 3:
            run.font.size = Pt(12)
    return h

def add_para(text, bold=False, indent=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = '宋体'
    run.font.size = Pt(12)
    run.bold = bold
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    if indent:
        p.paragraph_format.first_line_indent = Cm(0.74)
    return p

def add_table(headers, rows):
    table = doc.add_table(rows=1+len(rows), cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = h
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                run.bold = True
                run.font.size = Pt(10)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = table.rows[ri+1].cells[ci]
            cell.text = str(val)
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.font.size = Pt(10)
    doc.add_paragraph()
    return table

def add_code(text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = 'Courier New'
    run.font.size = Pt(9)
    p.paragraph_format.left_indent = Cm(1.0)
    return p

# ============================================================
# TITLE PAGE
# ============================================================
for _ in range(6):
    doc.add_paragraph()

title_p = doc.add_paragraph()
title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title_p.add_run('软件说明书')
run.font.size = Pt(28)
run.bold = True
run.font.name = '宋体'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

doc.add_paragraph()

subtitle_p = doc.add_paragraph()
subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = subtitle_p.add_run('FlexiGuard 上下文感知访问控制系统\n（Context-Aware Access Control System）')
run.font.size = Pt(16)
run.font.name = '宋体'
run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

for _ in range(4):
    doc.add_paragraph()

info_items = [
    ('软件名称', 'FlexiGuard 上下文感知访问控制系统'),
    ('软件简称', 'CAAC System'),
    ('版本号', 'V3.0'),
    ('开发单位', '西北工业大学'),
    ('开发语言', 'Java 17 / JavaScript / Solidity'),
    ('运行环境', 'Spring Boot 3.2 + Hyperledger Fabric 2.5 + IPFS'),
]
for label, value in info_items:
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(f'{label}：{value}')
    run.font.size = Pt(14)
    run.font.name = '宋体'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

doc.add_page_break()

# ============================================================
# TABLE OF CONTENTS (Manual)
# ============================================================
add_heading_custom('目  录', level=1)
toc_items = [
    '一、软件概述',
    '    1.1 开发背景',
    '    1.2 系统定位',
    '    1.3 系统架构总览',
    '二、软件总体设计',
    '    2.1 体系结构',
    '    2.2 软件结构图',
    '    2.3 三层架构设计',
    '    2.4 系统数据流',
    '三、功能模块详细设计',
    '    3.1 用户认证模块（AuthController）',
    '    3.2 文件访问控制模块（FileAccessController）',
    '    3.3 实时事件推送模块（LiveEventController）',
    '    3.4 Oracle评估模块（OracleApplication）',
    '    3.5 Fabric链码模块（CAACContract）',
    '    3.6 前端交互模块',
    '四、接口设计',
    '    4.1 RESTful API接口列表',
    '    4.2 内部服务接口',
    '    4.3 区块链接口',
    '    4.4 IPFS存储接口',
    '五、模块名称与功能说明',
    '六、函数名称与功能说明',
    '    6.1 核心服务类函数',
    '    6.2 链码函数',
    '七、核心算法说明',
    '    7.1 Algorithm 1 — 上下文感知访问决策',
    '    7.2 Algorithm 2 — 持续撤销检测',
    '    7.3 BV-GCA — 边界值引导的信任奖励吞吐量分配',
    '    7.4 CSRP — 集群风险传播',
    '    7.5 EMA信任演化',
    '    7.6 风险预算管理',
    '八、运行设计',
    '    8.1 系统运行流程',
    '    8.2 部署架构',
    '    8.3 安全机制',
    '    8.4 性能指标',
]
for item in toc_items:
    p = doc.add_paragraph()
    run = p.add_run(item)
    run.font.size = Pt(12)
    run.font.name = '宋体'
    run.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

doc.add_page_break()

# ============================================================
# 一、软件概述
# ============================================================
add_heading_custom('一、软件概述', level=1)

add_heading_custom('1.1 开发背景', level=2)
add_para(
    '随着云计算、物联网和移动办公的普及，传统的基于网络边界的安全模型（城堡-护城河模型）已无法应对'
    '现代网络环境中的安全威胁。零信任安全架构（Zero-Trust Architecture）应运而生，其核心原则是"从不信任，'
    '始终验证"。基于此背景，本项目设计并实现了一个基于区块链的上下文感知访问控制系统——FlexiGuard CAAC。',
    indent=True
)
add_para(
    '该系统结合了Hyperledger Fabric区块链作为策略决策点（PDP）与策略执行点（PEP）的网关层，'
    '利用IPFS进行文件存储，通过多维上下文感知评分来实现细粒度的动态访问控制决策。',
    indent=True
)

add_heading_custom('1.2 系统定位', level=2)
add_para(
    'CAAC系统是一个面向高安全需求环境的文件访问控制系统，适用于：',
    indent=True
)
add_para('• 企业内部敏感文档的精细化管理')
add_para('• 跨组织协作场景下的安全文件共享')
add_para('• 移动办公环境下的动态访问控制')
add_para('• 需要合规审计的监管场景')

add_heading_custom('1.3 系统架构总览', level=2)
add_para(
    '系统采用三层架构设计，将访问控制决策逻辑、策略执行和数据存储分离：',
    indent=True
)
add_para('• 展示层（前端）：基于HTML/CSS/JavaScript的Web界面，提供用户交互、文件管理、实时监控等功能')
add_para('• 策略执行层（网关）：基于Spring Boot 3.2的Java后端网关，负责身份认证、上下文解析、风险评估和IPC操作')
add_para('• 策略决策层（Oracle + 区块链）：基于Hyperledger Fabric的链码实现Algorithm 1决策引擎，提供不可篡改的审计记录')

doc.add_page_break()

# ============================================================
# 二、软件总体设计
# ============================================================
add_heading_custom('二、软件总体设计', level=1)

add_heading_custom('2.1 体系结构', level=2)
add_para(
    'CAAC系统采用面向微服务的分层体系结构，各层之间通过RESTful API进行通信。系统运行时，'
    '前端网关接收来自用户的访问请求，采集原始上下文信息（浏览器类型、网络状态、屏幕分辨率、时区等），'
    '将其解析为数学评分后，通过HMAC签名的安全信道发送至Oracle层。Oracle层调用Fabric链码执行'
    'Algorithm 1访问决策算法，根据用户角色（R_sub）、信任值（T_sub）、环境评分（CE_score）等'
    '综合判断是否允许访问。对于已批准的访问会话，Algorithm 2在后台持续监控上下文变化，'
    '一旦检测到环境降级立即撤销访问权限。',
    indent=True
)

add_heading_custom('2.2 软件结构图', level=2)
add_para('系统整体结构可分为以下六大子系统：', indent=True)

# Architecture table
add_table(
    ['子系统', '模块', '技术栈', '功能说明'],
    [
        ['前端展示系统', 'caac-website', 'HTML/CSS/JS, Chart.js, Vite', '用户交互界面、实时数据可视化'],
        ['网关服务系统', 'caac-gateway', 'Spring Boot 3.2, Java 17', '策略执行、认证、上下文解析、IPFS集成'],
        ['Oracle决策系统', 'caac-oracle', 'Spring Boot, Fabric SDK', '策略决策转发、HMAC验证、CAAR提交'],
        ['Fabric区块链系统', 'caac-chaincode', 'Java Chaincode, Fabric 2.5', '决策算法执行、CAAR记录存储'],
        ['分布式存储系统', 'IPFS Kubo', 'IPFS API v0', '文件加密存储与内容寻址'],
        ['测试基准系统', 'benchmarks', 'Python3', '攻击模拟、性能测试、合规验证'],
    ]
)

add_heading_custom('系统层次结构', level=3)
add_para(
    '系统的层次从上到下依次为：',
    indent=True
)
add_para('第一层 — 用户交互层（展示层）')
add_para('    ├─ 登录注册页面 (login.html)')
add_para('    ├─ 仪表盘 (dashboard.html)')
add_para('    ├─ 文件概览 (overview.html)')
add_para('    ├─ 场景模拟 (scenarios.html)')
add_para('    ├─ 管理后台 (admin.html)')
add_para('    ├─ 个人资料 (profile.html)')
add_para('    └─ 消息中心 (messages.html)')
add_para('')
add_para('第二层 — 策略执行层（网关层）')
add_para('    ├─ 认证控制 (AuthController)')
add_para('    ├─ 文件访问控制 (FileAccessController)')
add_para('    ├─ 实时事件推送 (LiveEventController)')
add_para('    ├─ 上下文解析 (ContextResolverService)')
add_para('    ├─ 风险预算管理 (RiskBudgetService)')
add_para('    ├─ 会话管理 (SessionManager)')
add_para('    ├─ 异常检测 (AnomalyDetector)')
add_para('    ├─ 审计日志 (AuditService)')
add_para('    └─ 撤销调度器 (RevocationScheduler)')
add_para('')
add_para('第三层 — 策略决策层（Oracle + Fabric）')
add_para('    ├─ 访问控制器 (AccessController)')
add_para('    ├─ CAAC服务 (CAACService)')
add_para('    ├─ Fabric网关配置 (FabricConfig)')
add_para('    └─ 链码合约 (CAACContract)')
add_para('')
add_para('底层支撑 — 区块链网络 + IPFS存储')
add_para('    ├─ Hyperledger Fabric 2.5 网络')
add_para('    └─ IPFS分布式文件系统')

doc.add_page_break()

add_heading_custom('2.3 三层架构设计', level=2)

add_heading_custom('2.3.1 展示层（前端）', level=3)
add_para(
    '展示层采用模块化的前端架构，使用Vite作为构建工具，支持ES Module标准。'
    '每个功能页面对应独立的JavaScript入口文件，通过RESTful API与后端网关通信。'
    '前端负责采集用户的原始上下文信息（通过navigator.connection获取网络类型、'
    'screen对象获取屏幕参数、navigator.language获取语言等），并在访问请求中携带这些信息。',
    indent=True
)

add_heading_custom('2.3.2 策略执行层（网关）', level=3)
add_para(
    '网关层基于Spring Boot 3.2框架构建，是系统的核心枢纽。其主要职责包括：',
    indent=True
)
add_para('(1) 用户认证管理：支持用户名/密码、TOTP二次认证、邮箱验证、手机OTP验证')
add_para('(2) 上下文解析：将浏览器采集的原始上下文转换为Algorithm 1所需的数学评分')
add_para('(3) 风险评估：计算对象风险（Object Risk）和环境风险（Environmental Risk）')
add_para('(4) 会话管理：管理活跃的文件访问会话，跟踪数据传输量')
add_para('(5) 持续撤销检测：Algorithm 2定期重新评估活动会话的上下文')
add_para('(6) 集群风险传播（CSRP）：基于子网的撤销事件传播风险信号')
add_para('(7) 异常行为检测：监控用户的访问模式，检测异常行为并自动封禁')
add_para('(8) 审计日志记录：使用HMAC确保审计日志的完整性')
add_para('(9) IPFS集成：文件的加密上传、解密下载和内容验证')

add_heading_custom('2.3.3 策略决策层（Oracle + Fabric）', level=3)
add_para(
    'Oracle层是网关和Fabric区块链之间的中间层。它接收来自网关的HMAC签名请求，'
    '验证签名后调用Fabric链码执行决策。Oracle负责处理三种类型的链上操作：',
    indent=True
)
add_para('(1) evaluateAccess — 执行Algorithm 1访问决策')
add_para('(2) recordSessionReceipt — 记录会话CAAR（上下文感知审计记录）')
add_para('(3) getSessionReceipt — 查询链上CAAR记录')

add_heading_custom('2.4 系统数据流', level=2)
add_para('系统的核心数据流路径如下：', indent=True)
add_para('① 用户通过浏览器发起文件访问请求')
add_para('② 浏览器自动采集原始上下文信息（网络、设备、时间、位置等）')
add_para('③ 网关认证用户身份，解析上下文为数学评分（L_trust, N_status, D_sec, T_req）')
add_para('④ 网关构建AccessRequest对象，通过HMAC签名发送至Oracle')
add_para('⑤ Oracle验证HMAC签名，调用Fabric链码执行Algorithm 1')
add_para('⑥ 链码计算DT_score和CE_score，返回PERMIT或DENY决策')
add_para('⑦ 若允许访问，注册会话，通过IPFS获取文件数据，以窗口预算方式流式传输')
add_para('⑧ Algorithm 2在后台持续监控会话，若上下文降级则立即撤销')
add_para('⑨ 会话结束后，生成CAAR记录提交至区块链存证')
add_para('⑩ 每次访问决策均记录防篡改审计日志')

doc.add_page_break()

# ============================================================
# 三、功能模块详细设计
# ============================================================
add_heading_custom('三、功能模块详细设计', level=1)

add_heading_custom('3.1 用户认证模块（AuthController）', level=2)
add_para(
    '用户认证模块负责处理所有与用户身份相关的请求，包括注册、登录、验证、密码管理等。'
    '该模块集成多种安全机制：CAPTCHA验证（支持数学验证码和hCaptcha）、TOTP双因素认证、'
    '邮箱验证、手机OTP验证、密码策略强制执行（至少8位，含大小写字母、数字和符号）、'
    '账户锁定（5次失败后锁定30分钟）、登录速率限制等。',
    indent=True
)

add_para('功能列表：', bold=True)
add_table(
    ['端点路径', 'HTTP方法', '功能说明'],
    [
        ['/api/auth/signup', 'POST', '用户注册，含CAPTCHA验证、邮箱/手机验证'],
        ['/api/auth/login', 'POST', '用户登录，支持自适应CAPTCHA和TOTP 2FA'],
        ['/api/auth/verify-email', 'GET', '邮箱验证链接处理'],
        ['/api/auth/verify-phone', 'POST', '手机OTP验证'],
        ['/api/auth/resend-verification', 'POST', '重新发送验证邮件/OTP'],
        ['/api/auth/2fa/setup', 'POST', '设置TOTP双因素认证'],
        ['/api/auth/2fa/confirm', 'POST', '确认TOTP设置'],
        ['/api/auth/2fa/disable', 'POST', '禁用TOTP认证'],
        ['/api/auth/change-password', 'POST', '修改密码'],
        ['/api/auth/reset-with-code', 'POST', '使用重置码重置密码'],
        ['/api/auth/logout', 'POST', '登出并清除会话'],
        ['/api/auth/me', 'GET', '获取当前用户信息'],
        ['/api/auth/captcha-challenge', 'GET', '获取数学验证码挑战'],
        ['/api/auth/captcha-config', 'GET', '获取CAPTCHA配置'],
    ]
)

add_heading_custom('3.2 文件访问控制模块（FileAccessController）', level=2)
add_para(
    '文件访问控制模块是系统的核心模块，负责处理文件注册、访问评估、流式传输和管理。'
    '该模块实现了完整的零信任访问控制流程，包括上下文感知决策、风险预算检查、'
    '分块窗口预算流式传输、会话管理和实时撤销。',
    indent=True
)

add_para('功能列表：', bold=True)
add_table(
    ['端点路径', 'HTTP方法', '功能说明'],
    [
        ['/api/files/registry', 'GET', '获取用户可访问的文件列表（基于R_sub/S_level过滤）'],
        ['/api/files/{fileId}/web-access', 'POST', '文件访问评估（核心决策点）'],
        ['/api/files/sessions/{sessionId}/stream', 'GET', '流式文件下载（含Algorithm 2持续监控）'],
        ['/api/files/upload', 'POST', '文件上传到IPFS（AES-256-GCM加密）'],
        ['/api/files/preview/{fileName}', 'GET', '管理员文件预览'],
        ['/api/files/health', 'GET', '服务健康检查'],
        ['/api/files/sessions/{sessionId}/degrade', 'POST', '模拟上下文降级（原型/测试）'],
        ['/api/files/sessions/{sessionId}/receipt', 'GET', '查询会话CAAR记录'],
        ['/api/files/admin/all', 'GET', '管理员获取所有文件列表'],
        ['/api/files/admin/{fileId}/approve', 'POST', '管理员审批文件'],
        ['/api/files/admin/{fileId}/reject', 'POST', '管理员拒绝文件'],
        ['/api/files/admin/budget/reset/{username}', 'POST', '重置用户风险预算'],
    ]
)

add_heading_custom('3.3 实时事件推送模块（LiveEventController）', level=2)
add_para(
    '该模块基于Server-Sent Events（SSE）技术，为前端提供实时事件推送功能。'
    '支持的事件类型包括：文件变更通知（上传、审批、拒绝、删除）、用户状态变更、'
    '文件访问事件、会话评分更新、会话撤销事件、集群风险更新等。'
    '管理员和普通用户分别接收不同范围的事件（管理员接收所有事件，用户仅接收与自己相关的）。',
    indent=True
)

add_para('事件类型列表：', bold=True)
add_table(
    ['事件类型', '推送范围', '触发时机'],
    [
        ['FILE_UPLOADED', '管理员', '用户上传新文件'],
        ['FILE_APPROVED/REJECTED/DELETED', '全部', '管理员操作文件'],
        ['USER_REGISTERED/CHANGED/DELETED', '管理员', '用户状态变化'],
        ['FILE_ACCESS', '管理员+本人', '每次访问决策（PERMIT/DENY）'],
        ['SESSION_SCORE_UPDATED', '管理员+本人', 'Algorithm 2定期评分更新'],
        ['SESSION_REVOKED', '管理员+本人', '会话被撤销'],
        ['CLUSTER_RISK_UPDATED', '管理员', '集群风险变化'],
        ['HEARTBEAT', '全部', '每25秒保活信号'],
    ]
)

add_heading_custom('3.4 Oracle评估模块（OracleApplication）', level=2)
add_para(
    'Oracle层是网关与Fabric区块链之间的安全中间层。所有请求均需携带HMAC-SHA256签名，'
    '包含时间戳（±5分钟窗口）和一次性随机数（防重放攻击）。Oracle验证通过后，'
    '通过Fabric Java SDK调用链码执行交易。',
    indent=True
)

add_para('端点列表：', bold=True)
add_table(
    ['端点路径', 'HTTP方法', '功能说明'],
    [
        ['/api/access/evaluate', 'POST', 'Algorithm 1访问决策评估'],
        ['/api/access/receipt/submit', 'POST', 'CAAR记录提交到区块链'],
        ['/api/access/receipt/query', 'POST', '查询链上CAAR记录'],
    ]
)

add_heading_custom('3.5 Fabric链码模块（CAACContract）', level=2)
add_para(
    'Fabric链码是策略决策点（PDP）的核心，实现Algorithm 1上下文感知访问决策算法。'
    '链码采用Hyperledger Fabric Java Chaincode API开发，部署在Fabric 2.5网络上的'
    'CAAC通道中。链码状态数据存储在CouchDB中，支持丰富的查询能力。',
    indent=True
)

add_para('交易函数列表：', bold=True)
add_table(
    ['函数名', '交易类型', '功能说明'],
    [
        ['initLedger', 'SUBMIT', '初始化账本'],
        ['evaluateAccess', 'EVALUATE', '执行Algorithm 1访问决策'],
        ['recordSessionReceipt', 'SUBMIT', '记录会话CAAR（单次写入，不可篡改）'],
        ['getSessionReceipt', 'EVALUATE', '查询指定会话的CAAR记录'],
    ]
)

add_heading_custom('3.6 前端交互模块', level=2)
add_para('前端包含多个功能页面，每个页面对应独立的JavaScript入口模块：', indent=True)

add_table(
    ['页面', 'JS入口', '核心功能'],
    [
        ['登录页 (login.html)', 'login.js', '用户登录、注册、密码重置'],
        ['仪表盘 (dashboard.html)', 'dashboard.js', '实时访问状态监控、风险可视化'],
        ['文件概览 (overview.html)', 'overview.js', '文件浏览、访问请求发起'],
        ['场景模拟 (scenarios.html)', 'scenarios.js', '攻击场景模拟与防御效果展示'],
        ['管理后台 (admin.html)', 'admin.js', '用户管理、文件审批、审计日志'],
        ['个人资料 (profile.html)', 'profile.js', '资料编辑、2FA设置'],
        ['消息中心 (messages.html)', 'messages.js', '用户间消息通信'],
    ]
)

doc.add_page_break()

# ============================================================
# 四、接口设计
# ============================================================
add_heading_custom('四、接口设计', level=1)

add_heading_custom('4.1 RESTful API接口列表', level=2)
add_para(
    '系统对外暴露RESTful API，所有API均通过HTTP协议进行通信。'
    '需要认证的接口需在请求头中携带Authorization: Bearer <token>。'
    '涉及敏感操作的接口还需携带X-CAAC-CSRF头。',
    indent=True
)

add_para('4.1.1 认证API（/api/auth/*）', bold=True)
add_table(
    ['接口路径', '方法', '请求参数', '响应说明'],
    [
        ['/api/auth/signup', 'POST', 'username, password, displayName, email, phone, captchaToken', '注册结果及验证状态'],
        ['/api/auth/login', 'POST', 'username, password, totpCode, captchaToken', '认证Token及用户信息'],
        ['/api/auth/verify-email', 'GET', 'username, token', '邮箱验证结果页'],
        ['/api/auth/verify-phone', 'POST', 'username, otp', '手机验证结果'],
        ['/api/auth/resend-verification', 'POST', 'username, type(email/phone)', '重发验证码'],
        ['/api/auth/2fa/setup', 'POST', 'Authorization', 'TOTP密钥及URI'],
        ['/api/auth/2fa/confirm', 'POST', 'code, Authorization', '2FA启用结果'],
        ['/api/auth/me', 'GET', 'Authorization', '用户详细信息'],
        ['/api/auth/logout', 'POST', 'Authorization', '登出确认'],
    ]
)

add_para('4.1.2 文件API（/api/files/*）', bold=True)
add_table(
    ['接口路径', '方法', '请求参数', '响应说明'],
    [
        ['/api/files/registry', 'GET', 'Authorization', '可访问文件列表'],
        ['/api/files/{fileId}/web-access', 'POST', 'RawContext JSON', '访问决策结果'],
        ['/api/files/sessions/{sessionId}/stream', 'GET', 'Authorization', '文件数据流'],
        ['/api/files/upload', 'POST', 'file(Multipart), sLevel, rules', '上传结果'],
        ['/api/files/admin/all', 'GET', 'Authorization(admin)', '所有文件列表'],
        ['/api/files/health', 'GET', '无', '服务健康状态'],
    ]
)

add_para('4.1.3 管理API（/api/auth/admin/*）', bold=True)
add_table(
    ['接口路径', '方法', '功能说明'],
    [
        ['GET /api/auth/admin/users', 'GET', '获取所有用户列表'],
        ['POST /api/auth/admin/users/{username}/role', 'POST', '修改用户角色（R_sub）'],
        ['POST /api/auth/admin/users/{username}/trust', 'POST', '修改用户信任值（T_sub）'],
        ['POST /api/auth/admin/users/{username}/status', 'POST', '修改用户状态'],
        ['POST /api/auth/admin/users/{username}/delete', 'POST', '删除用户'],
        ['GET /api/auth/admin/anomalies', 'GET', '获取异常告警列表'],
        ['GET /api/auth/admin/audit', 'GET', '获取审计日志'],
    ]
)

add_heading_custom('4.2 内部服务接口', level=2)
add_para('网关内部各服务之间通过Spring依赖注入进行调用，主要服务接口包括：', indent=True)

add_table(
    ['服务接口', '实现类', '核心方法'],
    [
        ['ContextResolverService', '上下文解析服务', 'resolve(), resolveLocationTrust(), resolveNetworkStatus(), resolveDeviceSecurity(), resolveTemporalConstraint(), computeObjectRisk(), computeEffectiveThreshold()'],
        ['UserService', '用户管理服务', 'register(), login(), getUserByToken(), changePassword(), isPasswordPolicyCompliant()'],
        ['SessionManager', '会话管理服务', 'register(), close(), getSession(), getActiveSessions(), evolveTSub()'],
        ['RiskBudgetService', '风险预算服务', 'checkBudget(), computeBudget(), recordDelivery(), getCumulativeLeakage()'],
        ['RevocationScheduler', '撤销调度服务', 'continuousRevocationCheck(), getClusterRisk(), getAdjustedMargin(), recordNetworkRevocation()'],
        ['AuditService', '审计日志服务', 'log(), getByUser(), getRecent(), getDecisionCounts()'],
        ['AnomalyDetector', '异常检测服务', 'recordAccess(), isBlocked(), getBFreqPenalty()'],
        ['OracleClient', 'Oracle通信客户端', 'evaluate(), submitReceipt(), queryReceipt()'],
    ]
)

add_heading_custom('4.3 区块链接口', level=2)
add_para(
    'Oracle层通过Hyperledger Fabric Java SDK与区块链网络交互。Fabric网络配置通过FabricConfig类加载，'
    '包括TLS证书、用户身份、Peer节点地址等。链码合约提供三种交易接口：',
    indent=True
)
add_para('• evaluateAccess: 评估访问决策（查询交易，不修改账本）')
add_para('• recordSessionReceipt: 记录CAAR（提交交易，修改账本，不可篡改）')
add_para('• getSessionReceipt: 查询CAAR（查询交易）')

add_heading_custom('4.4 IPFS存储接口', level=2)
add_para(
    '系统通过IPFS（InterPlanetary File System）实现分布式文件存储。IpfsService封装了与IPFS节点的交互：',
    indent=True
)
add_para('• 上传流程：文件明文 → AES-256-GCM加密 → 上传至IPFS → 返回内容标识符（CID）')
add_para('• 下载流程：从IPFS获取密文 → CID验证 → AES-256-GCM解密 → 返回明文')
add_para('• 密钥管理：每个文件使用独立的AES-256密钥和IV，密钥文件存储在本地')
add_para('• 多网关容错：支持多个IPFS网关地址作为后备，确保高可用')
add_para('• CID验证：使用Kubo API的only-hash模式验证下载内容的完整性')

doc.add_page_break()

# ============================================================
# 五、模块名称与功能说明
# ============================================================
add_heading_custom('五、模块名称与功能说明', level=1)

add_para('系统模块分为后端服务模块和前端展示模块两大部分：', indent=True)

add_para('5.1 后端服务模块', bold=True)
add_table(
    ['模块名称', '包名/路径', '功能说明'],
    [
        ['网关主应用', 'caac-gateway.GatewayApplication', 'Spring Boot入口，启动REST服务和定时调度'],
        ['认证控制器', 'gateway.controller.AuthController', '处理用户认证、注册、登录、2FA、密码管理'],
        ['文件访问控制器', 'gateway.controller.FileAccessController', '文件访问评估、流传输、上传、管理'],
        ['实时事件控制器', 'gateway.controller.LiveEventController', 'SSE实时事件推送'],
        ['用户服务', 'gateway.service.UserService', '用户注册、登录、令牌管理、密码策略'],
        ['上下文解析服务', 'gateway.service.ContextResolverService', '原始上下文的数学评分映射'],
        ['Oracle客户端', 'gateway.service.OracleClient', '与Oracle层的HMAC签名通信'],
        ['会话管理器', 'gateway.service.SessionManager', '活跃会话管理、信任值演化'],
        ['风险预算服务', 'gateway.service.RiskBudgetService', '数据泄露预算跟踪与限制'],
        ['撤销调度器', 'gateway.service.RevocationScheduler', 'Algorithm 2持续撤销检测、CSRP'],
        ['审计服务', 'gateway.service.AuditService', 'HMAC保护的防篡改审计日志'],
        ['异常检测器', 'gateway.service.AnomalyDetector', '行为异常检测（突发、信任跳变、敏感度升级）'],
        ['CAPTCHA服务', 'gateway.service.CaptchaService', '数学验证码和hCaptcha验证'],
        ['TOTP服务', 'gateway.service.TotpService', '基于时间的一次性密码（双因素认证）'],
        ['邮件服务', 'gateway.service.EmailService', '验证邮件发送'],
        ['消息服务', 'gateway.service.MessageService', '用户间消息通信'],
        ['CSRF令牌服务', 'gateway.service.CsrfTokenService', 'CSRF令牌签发与验证'],
        ['IPFS服务', 'gateway.service.IpfsService', '文件加密上传、解密下载到IPFS'],
        ['安全工具类', 'gateway.service.SecurityUtils', 'BCrypt哈希、HMAC、SHA-256、常量时间比较'],
        ['速率限制服务', 'gateway.service.RateLimitService', '基于滑动窗口的速率限制'],
        ['文件注册表', 'gateway.config.FileRegistry', '文件元数据注册与管理'],
        ['安全头过滤器', 'gateway.config.SecurityHeadersFilter', 'HTTP安全头设置'],
        ['CSRF保护过滤器', 'gateway.config.CsrfProtectionFilter', 'CSRF令牌验证'],
        ['Cookie认证桥', 'gateway.config.CookieAuthBridgeFilter', 'Cookie认证桥接'],
        ['预算属性配置', 'gateway.config.CaacBudgetProperties', 'BV-GCA预算参数外部化配置'],
        ['Oracle应用', 'caac-oracle.OracleApplication', 'Oracle层Spring Boot入口'],
        ['Oracle访问控制器', 'oracle.controller.AccessController', '请求验证、路由到链码'],
        ['CAAC服务', 'oracle.service.CAACService', '通过Fabric SDK调用链码'],
        ['Fabric配置', 'oracle.config.FabricConfig', 'Fabric网关连接配置'],
        ['CAAC链码', 'caac-chaincode.CAACContract', 'Fabric链码合约实现Algorithm 1'],
    ]
)

add_para('5.2 前端展示模块', bold=True)
add_table(
    ['页面名称', '文件', '功能说明'],
    [
        ['登录页面', 'login.html', '用户登录、注册、密码重置、TOTP 2FA'],
        ['仪表盘', 'dashboard.html', '访问状态、风险评分、实时事件可视化'],
        ['文件概览', 'overview.html', '文件浏览、访问权限查看、发起访问请求'],
        ['场景模拟', 'scenarios.html', '攻击场景模拟与防御效果展示'],
        ['管理后台', 'admin.html', '用户管理、文件审批、审计、异常告警'],
        ['个人资料', 'profile.html', '个人信息编辑、2FA设置、密码修改'],
        ['消息中心', 'messages.html', '用户间消息收发'],
        ['运行时监控', 'runtime-monitor.js', '实时运行时拓扑可视化'],
    ]
)

doc.add_page_break()

# ============================================================
# 六、函数名称与功能说明
# ============================================================
add_heading_custom('六、函数名称与功能说明', level=1)

add_heading_custom('6.1 核心服务类函数', level=2)

add_para('6.1.1 FileAccessController 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['webAccess(fileId, rawContext, request, authHeader)', 'ResponseEntity', '文件访问核心入口：上下文解析、Oracle评估、风险预算、会话注册'],
        ['streamFile(sessionId, authHeader, request, response)', 'void', '流式文件传输：窗口预算控制、Algorithm 2实时撤销监控'],
        ['uploadFile(file, sLevel, description, rules, authHeader)', 'ResponseEntity', '文件上传：AES-256-GCM加密上传到IPFS'],
        ['checkFileRules(fileEntry, user)', 'String', '检查文件自定义规则（require_2fa, require_org, max_daily_access, min_trust）'],
        ['computeWindowBudget(tier, fileSize, tSub, n)', 'long', 'BV-GCA窗口预算计算：L(m,S,T_sub,n)公式'],
        ['previewFile(fileName, cid, authHeader, response)', 'void', '管理员文件预览'],
        ['getRegistry(authHeader)', 'ResponseEntity', '获取用户可访问文件列表'],
    ]
)

add_para('6.1.2 AuthController 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['signup(body, request)', 'ResponseEntity', '用户注册：验证CAPTCHA、输入校验、创建用户'],
        ['login(body, request, response)', 'ResponseEntity', '用户登录：自适应CAPTCHA、TOTP验证、签发Token'],
        ['setup2FA(authHeader)', 'ResponseEntity', '生成TOTP密钥和配置URI'],
        ['confirm2FA(body, authHeader)', 'ResponseEntity', '确认TOTP设置生效'],
        ['changePassword(body, authHeader)', 'ResponseEntity', '修改密码（当前密码验证+新密码策略检查）'],
        ['resetWithCode(body, request)', 'ResponseEntity', '使用重置码重置密码'],
    ]
)

add_para('6.1.3 ContextResolverService 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['resolve(rawContext, clientIp, user)', 'AccessRequest', '将原始上下文映射为数学评分，构建访问请求'],
        ['resolveLocationTrust(ip)', 'double', '根据IP地址解析位置信任度（L_trust）'],
        ['resolveNetworkStatus(networkType)', 'double', '根据网络类型解析网络状态（N_status）'],
        ['resolveDeviceSecurity(userAgent, platform, colorDepth, screenW, screenH)', 'double', '解析设备安全评分（D_sec），含头检测/攻击工具检测/平台一致性检查'],
        ['resolveTemporalConstraint(timestamp, timezone)', 'double', '连续时间风险函数计算时间约束（T_req）'],
        ['computeObjectRisk(accessCount, fileSize, uploadedAt)', 'double', '计算对象风险评分（O_risk）'],
        ['computeEffectiveThreshold(pReq, oRisk)', 'double', '计算经对象风险调整的有效阈值（P_eff）'],
    ]
)

add_para('6.1.4 RevocationScheduler 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['continuousRevocationCheck()', 'void', 'Algorithm 2：每秒检查所有活跃会话，必要时撤销'],
        ['getClusterRisk(networkFingerprint)', 'double', '计算指定子网的集群风险值R_N(t)'],
        ['getAdjustedMargin(session)', 'double', '计算CSRP调整后的风险余量'],
        ['recordNetworkRevocation(session)', 'void', '记录网络撤销事件到集群风险状态'],
        ['isSubnetBlocked(networkFingerprint)', 'boolean', '检查子网是否被自动封锁'],
        ['evaluateClusterAutoBlock()', 'void', '每30秒评估集群风险是否触发子网自动封锁'],
        ['shouldResetAcceleration(session, currentDtScore, currentTier)', 'boolean', '判断是否应重置加速状态'],
    ]
)

add_para('6.1.5 SessionManager 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['register(sessionId, fileId, context, ownerUsername)', 'ActiveSession', '注册新的活跃会话'],
        ['close(sessionId)', 'void', '关闭会话：触发信任演化、生成CAAR记录'],
        ['getEvolvedTSub(userId, defaultTSub)', 'double', '获取用户演化后的信任值'],
        ['evolveTSub(userId, currentTSub, wasRevoked, rSub)', 'void', 'EMA信任演化：自适应gamma(R_sub) + 不对称恢复'],
        ['evictStaleSessions()', 'void', '每60秒清理过期会话'],
    ]
)

add_para('6.1.6 RiskBudgetService 类', bold=True)
add_table(
    ['函数名', '返回类型', '功能说明'],
    [
        ['checkBudget(userId, fileId, tSub, fileSize, isText)', 'String', '检查风险预算状态（OK/HIGH_RISK/DENY）'],
        ['computeBudget(tSub, fileSize, isText)', 'long', '计算风险预算上限B(u,o,t)'],
        ['recordDelivery(userId, fileId, bytes)', 'void', '记录数据传输量到累积泄露'],
        ['getCumulativeLeakage(userId, fileId)', 'long', '获取当前周期累积数据泄露量'],
    ]
)

add_heading_custom('6.2 链码函数', level=2)
add_table(
    ['函数名', '交易类型', '输入参数', '功能说明'],
    [
        ['evaluateAccess', 'EVALUATE', 'rSub, tSub, bFreq, sLevel, pReq, lTrust, nStatus, dSec, tReq, w1-w3, alpha, beta, lambda, tau', '执行Algorithm 1决策：计算CE_score和DT_score，与P_req比较后返回PERMIT/DENY'],
        ['recordSessionReceipt', 'SUBMIT', 'sessionHash, userHash, fileId, rgcaTier, bytesDelivered, wasRevoked, leakageBound, budgetUsed, budgetLimit, clusterRisk, compliant', '记录CAAR到区块链：写入"receipt_{sessionHash}"键'],
        ['getSessionReceipt', 'EVALUATE', 'sessionHash', '查询链上CAAR记录：返回JSON格式的完整记录'],
    ]
)

doc.add_page_break()

# ============================================================
# 七、核心算法说明
# ============================================================
add_heading_custom('七、核心算法说明', level=1)

add_heading_custom('7.1 Algorithm 1 — 上下文感知访问决策', level=2)
add_para(
    'Algorithm 1是系统的核心决策算法，运行在Fabric链码中。它基于多维上下文评分计算综合信任值，'
    '并与所需阈值比较后做出访问决策。',
    indent=True
)

add_para('7.1.1 输入参数', bold=True)
add_table(
    ['参数', '范围', '说明'],
    [
        ['R_sub', '1-5', '用户角色/安全许可级别（Junior=1, Staff=2, Senior=3, Manager=4, Admin=5）'],
        ['T_sub', '0.0-1.0', '用户历史信任评分'],
        ['B_freq', '≥0', '行为频率（访问频次），用于惩罚异常高频访问'],
        ['S_level', '1-5', '资源敏感度级别'],
        ['P_req', '0.0-1.0', '所需最低DT_score阈值'],
        ['L_trust', '0.0-1.0', '位置/IP信任度'],
        ['N_status', '0.0-1.0', '网络安全状态'],
        ['D_sec', '0.0-1.0', '设备安全评分'],
        ['T_req', '0.0/1.0', '时间约束（工作时间/非工作时间）'],
        ['w1,w2,w3', '权重', '环境评分权重，w1+w2+w3=1.0'],
        ['α,β', '权重', 'DT_score权重，α+β=1.0'],
        ['λ', '衰减率', '行为惩罚衰减率'],
        ['τ', '阈值', '正常行为频次阈值'],
    ]
)

add_para('7.1.2 计算步骤', bold=True)
add_para('第一步：计算环境评分（CE_score）')
add_para('  R_interaction = max(0, (1 - D_sec) × N_status)')
add_para('  CE_base = w1×L_trust + w2×N_status + w3×D_sec')
add_para('  CE_score = max(0, CE_base - δ×R_interaction) × T_req')
add_para('  其中δ=0.3为上下文交互惩罚系数')
add_para('')
add_para('第二步：计算行为惩罚因子')
add_para('  Φ(B_freq) = { 1.0, B_freq ≤ τ; exp(-λ×(B_freq-τ)), B_freq > τ }')
add_para('')
add_para('第三步：计算决策信任值（DT_score）')
add_para('  DT_score = (α×T_sub + β×CE_score) × Φ(B_freq)')
add_para('')
add_para('第四步：决策判定')
add_para('  若 R_sub ≥ S_level 且 DT_score ≥ P_req → PERMIT，否则 → DENY')

add_heading_custom('7.2 Algorithm 2 — 持续撤销检测', level=2)
add_para(
    'Algorithm 2在文件流式传输过程中持续运行，定期重新评估活跃会话的上下文。'
    '它运行在网关上，通过定时任务（@Scheduled(fixedDelay=1000)）每秒检查所有活跃会话。',
    indent=True
)

add_para('7.2.1 轮询间隔', bold=True)
add_para('根据风险余量（margin = DT_score - P_req）自适应调整轮询频率：')
add_para('  HIGH-RISK (margin < 0.1): Δt = 2秒')
add_para('  MEDIUM-RISK (0.1 ≤ margin < 0.3): Δt = 3秒')
add_para('  LOW-RISK (margin ≥ 0.3): Δt = 4秒')
add_para('')
add_para('7.2.2 加速机制', bold=True)
add_para('在上下文稳定的情况下，Algorithm 2会累积"稳定检查计数"（n），'
         '通过ψ(n)参数增加窗口预算，实现信任奖励吞吐量分配。当检测到上下文变化（DT偏差>5%或层级切换）时，'
         '加速状态立即重置。')

add_heading_custom('7.3 BV-GCA — 边界值引导的信任奖励吞吐量分配', level=2)
add_para(
    'BV-GCA（Boundary-Value Guided Trust-Rewarded Throughput Allocation）是系统的核心创新算法，'
    '通过公式化方法动态分配文件传输窗口预算，在保证安全性的同时优化用户体验。',
    indent=True
)

add_para('7.3.1 窗口预算函数', bold=True)
add_para('L(m, S, T_sub, n) = min(B_max(m), μ(m) × (1 + κ×T_sub) × S^θ(m) × (1 + ψ(m)×n))')
add_para('')
add_para('参数说明：')
add_para('  m — 风险等级（LOW/MEDIUM/HIGH）')
add_para('  S — 文件大小（字节）')
add_para('  T_sub — 用户信任值')
add_para('  n — 稳定检查计数（加速因子）')
add_para('  κ=1.0 — 信任奖励系数（最高2倍吞吐量）')
add_para('')
add_para('7.3.2 各等级参数配置', bold=True)
add_table(
    ['参数', 'HIGH-RISK', 'MEDIUM-RISK', 'LOW-RISK'],
    [
        ['θ(m)', '0.500', '0.585', '0.766'],
        ['μ(m)', '21.333', '19.709', '4.300'],
        ['ψ(m)', '0.0', '0.6876', '0.2392'],
        ['B_max(m)', '512 KB', '2 MB', '4 MB'],
    ]
)

add_para('7.3.3 理论保证', bold=True)
add_para('Theorem 1 — 吞吐量限制：L ≤ B_max(m)（上限钳位）')
add_para('Theorem 1a — 次线性文件大小缩放：L(S2)/L(S1) ≤ (S2/S1)^θ')
add_para('Theorem 1b — 有界信任差分：L(T_sub1)/L(T_sub2) ≤ 1 + κ')
add_para('Theorem 1c — 加速递进：L(n) ≤ L(0) × (1 + ψ×n)')
add_para('Theorem 2 — 累积预算约束：L_total(u,o,t) ≤ B + G + S_max')
add_para('Theorem 3 — CAAR合规性：每个窗口的传输量不超过其活跃时的层级天花板')

add_heading_custom('7.4 CSRP — 集群风险传播', level=2)
add_para(
    'CSRP（Cluster Risk Propagation）是BV-GCA的子算法，用于检测和响应来自同一子网的关联风险。'
    '当同一/24子网中的多个会话被撤销时，CSRP会计算集群风险值并在该子网内传播风险信号。',
    indent=True
)

add_para('7.4.1 集群风险计算', bold=True)
add_para('R_N(t) = Σ exp(-λ_c × (t - t_revoke_i))')
add_para('  λ_c = 0.1 — 风险衰减常数')
add_para('  R_N(t) ∈ [0, 1.0]（上限钳位）')
add_para('')
add_para('7.4.2 调整后的风险余量', bold=True)
add_para('m\' = m - η_N × min(R_N, 1.0)')
add_para('  η_N = 0.2 — 集群风险影响因子')
add_para('')
add_para('7.4.3 子网自动封锁', bold=True)
add_para('当R_N ≥ 0.7持续5分钟 → 子网自动封锁15分钟')

add_heading_custom('7.5 EMA信任演化', level=2)
add_para(
    '信任演化机制使用指数移动平均（EMA）算法，根据会话结果动态调整用户的T_sub值。'
    '该机制采用不对称的恢复策略：撤销时快速衰减，恢复正常行为后缓慢恢复。',
    indent=True
)

add_para('7.5.1 自适应基伽马值', bold=True)
add_para('γ_base(R_sub) = 0.05 + 0.025 × (5 - R_sub)')
add_para('  R_sub=5（管理员）→ γ=0.05（最稳定）')
add_para('  R_sub=3（普通用户）→ γ=0.10')
add_para('  R_sub=1（访客）→ γ=0.15（最波动）')
add_para('')
add_para('7.5.2 不对称应用', bold=True)
add_para('  - 撤销时：γ_eff = γ_base × 2.0（快速衰减）')
add_para('  - 连续3次正常会话后：γ_eff = γ_base × 0.5（缓慢恢复）')
add_para('  - 恢复阈值前：γ_eff = 0.0（保持信任不变）')

add_heading_custom('7.6 风险预算管理', level=2)
add_para(
    '风险预算管理模块跟踪每个用户每天对每个文件的数据泄露量，防止信息过度泄露。'
    '预算基于用户信任值和文件特性动态计算。',
    indent=True
)

add_para('7.6.1 预算函数', bold=True)
add_para('B(u,o,t) = β × max(0.2, S_file_size / β) × (1 + T_sub)')
add_para('  β_text = 500KB（文本文件的基准乘数）')
add_para('  β_binary = 50MB（二进制文件的基准乘数）')
add_para('')
add_para('7.6.2 预算状态', bold=True)
add_para('  OK（正常）: 已用 ≤ 预算 → 正常传输')
add_para('  HIGH_RISK（高风）: 预算 < 已用 ≤ 预算 + 宽限 → 强制HIGH-RISK层级')
add_para('  DENY（拒绝）: 已用 > 预算 + 宽限 → 拒绝访问')
add_para('')
add_para('7.6.3 宽限贡献', bold=True)
add_para('G = min(B_max(HIGH), S_remaining, ρ × B)')
add_para('  ρ = 0.5 — 宽限分数')
add_para('  B_max(HIGH) = 512KB')

doc.add_page_break()

# ============================================================
# 八、运行设计
# ============================================================
add_heading_custom('八、运行设计', level=1)

add_heading_custom('8.1 系统运行流程', level=2)

add_para('8.1.1 用户注册流程', bold=True)
add_para('① 用户填写注册信息（用户名、密码、邮箱、手机号）')
add_para('② 前端调用 /api/auth/captcha-challenge 获取数学验证码')
add_para('③ 用户完成验证码验证')
add_para('④ 前端发送 POST /api/auth/signup 请求')
add_para('⑤ 后端验证：速率限制 + CAPTCHA + 用户名格式 + 密码策略 + 邮箱格式')
add_para('⑥ BCrypt哈希密码，创建用户（状态设为UNVERIFIED）')
add_para('⑦ 发送验证邮件（含15分钟有效期的Token）')
add_para('⑧ 用户点击邮件中的验证链接')
add_para('⑨ 邮箱验证通过后，若无需管理员审批则自动激活')
add_para('⑩ 触发实时事件通知管理员')

add_para('8.1.2 文件访问流程', bold=True)
add_para('① 用户在文件概览页选择文件，发起访问请求')
add_para('② 前端采集原始上下文（网络类型、平台、屏幕、时区等）')
add_para('③ 发送 POST /api/files/{fileId}/web-access 请求')
add_para('④ 后端验证用户认证状态和异常封禁')
add_para('⑤ 检查CSRP子网封锁状态')
add_para('⑥ 计算对象风险 O_risk = 0.4×novelty + 0.3×sizeFactor + 0.3×ageFactor')
add_para('⑦ 解析上下文为数学评分（L_trust, N_status, D_sec, T_req）')
add_para('⑧ 调用Oracle → Fabric链码执行Algorithm 1')
add_para('⑨ 若PERMIT：检查风险预算 → 注册会话 → 返回流式传输端点')
add_para('⑩ Algorithm 2开始持续监控该会话')

add_para('8.1.3 文件流式传输流程', bold=True)
add_para('① 客户端连接 /api/files/sessions/{sessionId}/stream')
add_para('② 服务器验证会话所有者身份')
add_para('③ 从IPFS获取文件（解密或直连）')
add_para('④ 基于风险层级计算窗口预算')
add_para('⑤ 以burstChunkSize=8KB为单位的窗口预算传输')
add_para('⑥ 窗口耗尽时重新评估Oracle，更新风险层级和预算')
add_para('⑦ 若Algorithm 2检测到上下文降级则撤销会话')
add_para('⑧ 传输完成或撤销时，生成CAAR记录提交至区块链')

add_para('8.1.4 实时监控流程', bold=True)
add_para('① 前端连接 SSE /api/events/stream')
add_para('② 服务器每25秒发送HEARTBEAT保活')
add_para('③ 文件访问（PERMIT/DENY）时推送FILE_ACCESS事件')
add_para('④ Algorithm 2运行时推送SESSION_SCORE_UPDATED事件')
add_para('⑤ 会话撤销时推送SESSION_REVOKED事件')
add_para('⑥ 集群风险变化时推送CLUSTER_RISK_UPDATED事件')
add_para('⑦ 管理员后台实时更新运行时拓扑可视化')

add_heading_custom('8.2 部署架构', level=2)
add_para('系统的最小部署架构包括以下组件：', indent=True)

add_table(
    ['组件', '技术选型', '端口', '说明'],
    [
        ['前端Web服务器', 'Nginx/Vite Dev Server', '5052/5173', '静态资源服务'],
        ['网关服务', 'Spring Boot 3.2 + Tomcat', '5051', '策略执行点（PEP）'],
        ['Oracle服务', 'Spring Boot 3.2 + Tomcat', '5050', '策略决策转发'],
        ['IPFS节点', 'Kubo', '5001/8080', '分布式文件存储'],
        ['Fabric Peer', 'Hyperledger Fabric 2.5', '7051', '区块链节点'],
        ['Fabric Orderer', 'Hyperledger Fabric 2.5', '7050', '排序服务'],
        ['CA节点', 'Fabric CA', '7054', '证书管理'],
        ['CouchDB', 'CouchDB', '5984', '链码状态数据库'],
    ]
)

add_heading_custom('8.3 安全机制', level=2)
add_para('系统实现的多层安全机制：', indent=True)

add_table(
    ['安全层面', '机制', '说明'],
    [
        ['认证安全', 'BCrypt密码哈希', 'Cost=12，抗GPU暴力破解'],
        ['认证安全', 'TOTP双因素认证', '基于HMAC-SHA1的30秒时间窗口'],
        ['认证安全', 'CAPTCHA验证', '数学验证码/hCaptcha，自适应挑战'],
        ['认证安全', '账户锁定', '5次失败锁定30分钟'],
        ['认证安全', '密码策略', '8位以上含大小写字母、数字、符号'],
        ['传输安全', 'HMAC-SHA256签名', 'Oracle请求签名防止篡改和重放'],
        ['传输安全', 'CSRF保护', 'HMAC绑定的双重提交令牌'],
        ['传输安全', 'SameSite=Strict Cookie', '防止CSRF攻击'],
        ['传输安全', 'HTTP安全头', 'CSP, HSTS, X-Frame-Options等'],
        ['存储安全', 'AES-256-GCM文件加密', '上传至IPFS前自动加密'],
        ['存储安全', 'CID验证', '下载时验证IPFS多哈希匹配'],
        ['存储安全', '审计日志HMAC', '防篡改审计跟踪'],
        ['访问安全', '零信任架构', '从不信任，始终验证'],
        ['访问安全', '上下文感知决策', '基于多维环境评分动态决策'],
        ['访问安全', '持续撤销检测', 'Algorithm 2实时监控'],
        ['访问安全', '子网风险传播（CSRP）', '同一/24子网内的关联风险传播'],
        ['访问安全', '异常检测', '访问突发、信任跳变、敏感度升级检测'],
        ['访问安全', '风险预算管理', '限制单位时间内的数据泄露量'],
        ['访问安全', 'Step-Up认证', '敏感操作需5分钟内重新认证'],
    ]
)

add_heading_custom('8.4 性能指标', level=2)
add_para('系统设计性能指标：', indent=True)
add_para('• 访问决策延迟（P99）：Oracle评估 < 3秒（含Fabric提交路径）')
add_para('• 网关HTTP超时配置：连接超时5秒，读取超时10秒')
add_para('• Algorithm 2轮询间隔：1-4秒自适应')
add_para('• 实时事件推送：SSE保活间隔25秒')
add_para('• 会话空闲超时：10分钟')
add_para('• 认证Token有效期：24小时')
add_para('• 邮箱验证Token有效期：15分钟')
add_para('• OTP有效期：5分钟（最多3次尝试）')
add_para('• IPFS上传超时：连接10秒，读取300秒')
add_para('• IPFS下载超时：连接8秒，读取30秒')
add_para('• 审计日志轮转阈值：5MB')
add_para('• 异常告警上限：500条')
add_para('• 内存信任状态超时：24小时')

# ============================================================
# SAVE
# ============================================================
output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '说明书.docx')
doc.save(output_path)
print(f"Document saved to: {output_path}")
