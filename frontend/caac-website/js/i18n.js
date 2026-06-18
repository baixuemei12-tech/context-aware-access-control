/* ============================================================
   CAAC System — Internationalization (i18n)
   English (en) / 简体中文 (zh) with live DOM translation
   ============================================================ */

(function () {
  const STORAGE_KEY = 'caac_lang';

  // ============================================================
  // TRANSLATION DICTIONARY
  // ============================================================
  const LOCALE = {
    en: {
      /* ---- App / Brand ---- */
      'app.title': 'Context Aware Access Control System',
      'app.subtitle': 'Context Aware Access Control System',
      'app.adminPanel': 'Admin Panel',
      'app.adminSubtitle': 'Context Aware Access Control — User & File Management',

      /* ---- Nav / Header ---- */
      'nav.admin': 'Admin',
      'nav.dashboard': 'Dashboard',
      'nav.scenarios': 'Scenarios',
      'nav.myProfile': 'My Profile',
      'nav.messages': 'Messages',
      'nav.systemOverview': 'System Overview',
      'nav.scenarioDemo': 'Scenario Demo',
      'nav.logout': 'Logout',
      'nav.language': 'Language',
      'nav.theme': 'Theme',

      /* ---- Login ---- */
      'login.title': 'Login',
      'login.signup': 'Sign Up',
      'login.username': 'Username',
      'login.password': 'Password',
      'login.btnLogin': 'Login',
      'login.btnCreate': 'Create Account',
      'login.placeholder.user': 'Enter username',
      'login.placeholder.pass': 'Enter password',
      'login.captchaRequired': 'CAPTCHA verification required',
      'login.resetPassword': 'Reset password with admin code',
      'login.totpTitle': 'Two-Factor Authentication',
      'login.totpDesc': 'Enter the 6-digit code from your authenticator app',
      'login.totpVerify': 'Verify',
      'login.totpBack': '← Back to login',
      'login.displayName': 'Display name',
      'login.placeholder.displayName': 'Your full name',
      'login.placeholder.signupUser': 'Choose a username',
      'login.placeholder.signupPass': 'At least 8 chars, mixed types',
      'login.placeholder.confirmPass': 'Repeat password',
      'login.confirmPassword': 'Confirm password',
      'login.email': 'Email',
      'login.emailRequired': '(required)',
      'login.phone': 'Phone',
      'login.phoneOptional': '(optional)',
      'login.resetSectionTitle': 'Reset password with code',
      'login.resetSectionDesc': 'Got a reset code from admin? Enter it here.',
      'login.resetCode': 'Reset code',
      'login.resetCodePlaceholder': '8-character code from admin',
      'login.resetNewPass': 'New password',
      'login.resetBtn': 'Set new password',
      'login.verifyEmailTitle': 'Check your email',
      'login.verifyEmailMsg': 'We sent a verification link to your email. Click the link to verify your account.',
      'login.resendEmail': 'Resend email',
      'login.enterCode': 'Enter verification code',
      'login.phoneCodeMsg': 'We sent a 6-digit code to your phone.',
      'login.btnVerify': 'Verify',
      'login.resendCode': 'Resend code',
      'login.waitingApproval': 'Waiting for admin approval',
      'login.approvalMsg': 'Your request is visible in the admin panel. You can log in after approval.',
      'login.backToLogin': 'Back to login',

      /* ---- Password rules ---- */
      'pwd.ruleLength': '8 or more characters',
      'pwd.ruleMix': 'uppercase, lowercase, number, and symbol',

      /* ---- Auth info box ---- */
      'auth.info': 'Your context is collected automatically when you access files. Role and trust level are managed by the system administrator.',
      'auth.gateway': 'Gateway',
      'auth.oracle': 'Oracle',
      'auth.storage': 'Storage',
      'auth.gatewayDesc': 'Policy enforced',
      'auth.oracleDesc': 'Chain verified',
      'auth.storageDesc': 'IPFS sealed',
      'auth.flow01': 'Authenticate',
      'auth.flow01Detail': 'BCrypt + CAPTCHA',
      'auth.flow02': 'Evaluate context',
      'auth.flow02Detail': 'device, network, trust',
      'auth.flow03': 'Stream approved files',
      'auth.flow03Detail': 'RGCA session monitor',

      /* ---- Dashboard ---- */
      'dash.envContext': 'Environmental context (C_E)',
      'dash.autoCollected': 'auto-collected',
      'dash.subjContext': 'Subject context (C_S)',
      'dash.fromLogin': 'from login',
      'dash.resContext': 'Resource context (C_R)',
      'dash.fromServer': 'from server registry',
      'dash.fileToAccess': 'File to access',
      'dash.searchFiles': 'Search files...',
      'dash.loadingFiles': 'Loading files...',
      'dash.sLevel': 'S_level (server-set)',
      'dash.pReq': 'P_req (server-set)',
      'dash.objContext': 'C_O — Object context (auto)',
      'dash.refreshContext': 'Refresh context',
      'dash.requestAccess': 'Request access',
      'dash.publishFile': 'Publish a file',
      'dash.requiresApproval': 'requires approval',
      'dash.uploadFile': 'Upload to IPFS',
      'dash.sensitivity': 'Sensitivity (0.1 - 1.0)',
      'dash.description': 'Description',
      'dash.file': 'File',
      'dash.accessRules': 'Access rules (optional)',
      'dash.ruleOrg': 'Require organization:',
      'dash.ruleOrgPlaceholder': 'e.g. NWPU (leave empty = any)',
      'dash.ruleMaxAccess': 'Max accesses/day:',
      'dash.ruleMinTrust': 'Min trust (T_sub):',
      'dash.riskInspector': 'Risk inspector',
      'dash.selection': 'selection',
      'dash.noRequest': 'No access request yet',
      'dash.noRequestDesc': 'Select a file on the left and click "Request access". Environmental context is collected automatically.',
      'dash.requestLog': 'Request log',
      'dash.clear': 'clear',
      'dash.systemReady': 'System ready. Waiting for requests...',
      'dash.accesses': 'accesses',
      'dash.fileSize': 'file size',
      'dash.rules': 'rules',
      'dash.roleTrustDesc': 'Role and trust assigned by administrator',
      'dash.processing': 'Processing...',
      'dash.gatewayStatus': 'connected',
      'dash.gatewayOffline': 'offline',
      'dash.checking': 'checking...',

      /* ---- Risk Inspector ---- */
      'ri.user': 'User',
      'ri.role': 'role pending',
      'ri.trust': 'T_sub',
      'ri.subjectTrust': 'subject trust',
      'ri.device': 'D_sec',
      'ri.deviceScore': 'device score',
      'ri.network': 'N_status',
      'ri.networkScore': 'network score',
      'ri.slevel': 'S_level',
      'ri.resourceClass': 'resource class',
      'ri.preq': 'P_req',
      'ri.effectiveThreshold': 'effective threshold',
      'ri.rgca': 'RGCA',
      'ri.noSession': 'no session',
      'ri.margin': 'Margin',
      'ri.marginDesc': 'DT - P_eff',
      'ri.admissionMargin': 'admission margin',
      'ri.waiting': 'waiting',
      'ri.selectFile': 'Select a file to see how subject trust, device/network context, resource sensitivity, and policy threshold combine before the gateway opens a stream.',

      /* ---- Context labels ---- */
      'ctx.ip': 'ip',
      'ctx.timestamp': 'timestamp',
      'ctx.timezone': 'timezone',
      'ctx.network': 'network',
      'ctx.platform': 'platform',
      'ctx.userAgent': 'user-agent',
      'ctx.screen': 'screen',
      'ctx.language': 'language',
      'ctx.colorDepth': 'color depth',
      'ctx.touch': 'touch',
      'ctx.user': 'user',
      'ctx.level': 'level',
      'ctx.threshold': 'threshold',

      /* ---- Admin ---- */
      'admin.securityOps': 'Security operations',
      'admin.opsDesc': 'One-glance posture from users, registry, anomalies, active sessions, and recent decisions.',
      'admin.pendingUsers': 'Pending users',
      'admin.approvalQueue': 'approval queue',
      'admin.pendingFiles': 'Pending files',
      'admin.highSensitivity': 'High sensitivity',
      'admin.lowTrust': 'Low trust',
      'admin.denyRevoke': 'Deny / revoke',
      'admin.anomalies': 'Anomalies',
      'admin.unreviewed': 'unreviewed',
      'admin.liveControlPath': 'Live control path',
      'admin.visualState': 'Visual state for this admin console.',
      'admin.gatewayHealth': 'Gateway health',
      'admin.oracleBridge': 'Oracle bridge',
      'admin.registry': 'Registry',
      'admin.anomalyDetector': 'Anomaly detector',
      'admin.checking': 'checking',
      'admin.standby': 'standby',
      'admin.loading': 'loading',
      'admin.runTimeMonitor': 'Run time monitor',
      'admin.liveTopology': 'live topology · benchmark stream',
      'admin.offline': 'offline',
      'admin.resetView': 'Reset view',
      'admin.clear': 'Clear',
      'admin.analyticsDashboard': 'Analytics dashboard',
      'admin.refresh': 'Refresh',
      'admin.decisionChart': 'Decisions (PERMIT vs DENY)',
      'admin.accessByFile': 'Access by file',
      'admin.activeUsers': 'Most active users',
      'admin.activity24h': 'Activity (last 24h)',
      'admin.registeredUsers': 'Registered users',
      'admin.onlineNow': 'Online now',
      'admin.registeredFiles': 'Registered files',
      'admin.sortAZ': 'Sort: name A-Z',
      'admin.sortZA': 'Sort: name Z-A',
      'admin.sortRole': 'Sort: role (high-low)',
      'admin.sortTrust': 'Sort: trust (high-low)',
      'admin.sortStatus': 'Sort: status',
      'admin.sortNewest': 'Sort: newest',
      'admin.searchUsers': 'Search users...',
      'admin.fileRegistry': 'File registry',
      'admin.searchFiles': 'Search files...',
      'admin.sortByStatus': 'Sort: status',
      'admin.sortBySLevel': 'Sort: S_level',
      'admin.sortByPReq': 'Sort: P_req',
      'admin.sortByName': 'Sort: name',
      'admin.sortByUploader': 'Sort: uploader',
      'admin.messages': 'Messages',
      'admin.newConv': '+ New',
      'admin.selectUser': 'Select user...',
      'admin.startConv': 'Start conversation',
      'admin.selectConv': 'Select a conversation',
      'admin.selectConvHint': 'Select a user from the left to view messages',
      'admin.typeReply': 'Type a reply...',
      'admin.send': 'Send',
      'admin.anomalyAlerts': 'Anomaly alerts',
      'admin.showReviewed': 'show reviewed',
      'admin.reviewAll': 'Review all',
      'admin.deleteAll': 'Delete all',
      'admin.accessAuditLog': 'Access audit log',
      'admin.filterAll': 'All',
      'admin.filterPendingUsers': 'Pending users',
      'admin.filterPendingFiles': 'Pending files',
      'admin.filterHighSensitivity': 'High sensitivity',
      'admin.filterLowTrust': 'Low trust',
      'admin.filterDenyRevoke': 'Deny / revoke',
      'admin.filterAnomalies': 'Anomalies',
      'admin.S3toS5': 'S3-S5 objects',

      /* ---- Runtime Monitor Legend ---- */
      'rtm.okPermit': 'OK / PERMIT',
      'rtm.pending': 'Pending / Evaluating',
      'rtm.denyBlocked': 'DENY / Blocked',
      'rtm.infoRegister': 'Info / Register',
      'rtm.streaming': 'streaming',
      'rtm.connecting': 'connecting',

      /* ---- Status / Messages ---- */
      'status.authenticated': 'Authenticated as',
      'status.permit': 'PERMIT',
      'status.deny': 'DENY',
      'status.blocked': 'BLOCKED',
      'status.error': 'ERROR',
      'status.revoked': 'Revoked',
      'status.pending': 'Pending',
      'status.approved': 'APPROVED',
      'status.rejected': 'REJECTED',
      'waiting': 'Waiting for requests...',

      /* ---- Errors ---- */
      'err.authRequired': 'Authentication required',
      'err.fileNotFound': 'File not found',
      'err.serverError': 'Server error',
      'err.networkError': 'Network error. Check connection.',
      'err.unknown': 'An unknown error occurred',

      /* ---- Overview Nav ---- */
      'ov.nav.trustFlow': 'Trust Flow',
      'ov.nav.architecture': 'Architecture',
      'ov.nav.algorithms': 'Algorithms',
      'ov.nav.bvgca': 'BV-GCA',
      'ov.nav.context': 'Context',
      'ov.nav.metrics': 'Metrics',

      /* ---- Overview Hero ---- */
      'ov.hero.title': 'Context Aware Access Control System / BV-GCA',
      'ov.hero.subtitle': 'A deployed prototype for blockchain-backed authorization, encrypted IPFS file delivery, risk-budgeted streaming, continuous revocation, anomaly blocking, and auditable session receipts.',
      'ov.hero.meta': 'Gateway · Oracle · Hyperledger Fabric · Kubo IPFS · Static web console',
      'ov.hero.metaAuthor': 'Matvei Prikhozhdenko · Supervisor: 陈亚兴 · Northwestern Polytechnical University',
      'ov.hero.encryptedIPFS': 'Encrypted IPFS',
      'ov.hero.mathCaptcha': 'Math CAPTCHA',
      'ov.hero.anomalyBlocking': 'Anomaly blocking',
      'ov.hero.accessSystem': 'Access the system →',
      'ov.hero.scenarioDemo': 'Scenario demo',
      'ov.hero.trustFlow': 'Trust flow ↓',
      'ov.hero.scrollHint': 'scroll to explore ↓',

      /* ---- Overview Trust Flow ---- */
      'ov.flow.title': 'Live trust flow',
      'ov.flow.desc': 'A visual path for the deployed request lifecycle. Demo mode keeps this presentation-friendly when Fabric or chaincode is intentionally offline.',
      'ov.flow.ready': 'ready',
      'ov.flow.checking': 'checking',
      'ov.flow.local': 'local',
      'ov.flow.optional': 'optional',
      'ov.flow.encrypted': 'encrypted',
      'ov.flow.browser.title': 'Browser',
      'ov.flow.browser.desc': 'Collects environment context and submits a token-authenticated request through the static console.',
      'ov.flow.gateway.title': 'Gateway',
      'ov.flow.gateway.desc': 'Authenticates users, resolves context, checks file rules, opens sessions, and streams data.',
      'ov.flow.oracle.title': 'Oracle',
      'ov.flow.oracle.desc': 'Signs and relays evaluateAccess and CAAR receipt calls to Fabric when the chain is available.',
      'ov.flow.fabric.title': 'Fabric',
      'ov.flow.fabric.desc': 'Executes the deterministic PDP path. In visual checks, this layer can remain offline.',
      'ov.flow.ipfs.title': 'IPFS',
      'ov.flow.ipfs.desc': 'Stores ciphertext by CID while the gateway enforces authorization before plaintext delivery.',

      /* ---- Overview Architecture ---- */
      'ov.arch.title': 'System architecture',
      'ov.arch.desc': 'Current deployed codebase: browser console, Spring Boot gateway, HMAC-protected oracle, Fabric chaincode, and encrypted IPFS storage',
      'ov.arch.l1.title': 'CAAC Gateway',
      'ov.arch.l1.desc': 'Public enforcement point. Authenticates users, resolves browser context, checks file rules, applies object risk, manages sessions, risk budgets, anomaly blocking, streaming, admin workflows, and CAAR receipt queries.',
      'ov.arch.l1.tech': 'Spring Boot · REST API · TOTP · Math CAPTCHA · RiskBudgetService · RevocationScheduler',
      'ov.arch.l2.title': 'CAAC Oracle',
      'ov.arch.l2.desc': 'Trusted chaincode bridge. It rejects unsigned calls, verifies HMAC-SHA256 signatures with timestamp and nonce, submits access evaluations, and writes/queries CAAR session receipts.',
      'ov.arch.l2.tech': 'Spring Boot · Fabric Gateway SDK · HMAC-SHA256 · Replay protection',
      'ov.arch.l3.title': 'Hyperledger Fabric Chaincode',
      'ov.arch.l3.desc': 'Deterministic policy decision point. Executes evaluateAccess for DT_score/F_auth decisions and recordSessionReceipt for CAAR compliance evidence.',
      'ov.arch.l3.tech': 'Java chaincode · evaluateAccess · recordSessionReceipt · O(1) evaluation path',
      'ov.arch.l4.title': 'Encrypted IPFS Storage',
      'ov.arch.l4.desc': 'Files are encrypted before IPFS upload. Approved registry entries map file IDs to CIDs, and the gateway decrypts only after authorization and session ownership checks.',
      'ov.arch.l4.tech': 'Kubo · AES-256-GCM · Per-file keys · Approval queue · Preview endpoint',
      'ov.arch.dataFlow': 'Data flow architecture',
      'ov.arch.dataFlowDesc': 'Request lifecycle through all four layers with HMAC-signed channels',

      /* ---- Overview Algorithms ---- */
      'ov.algo.title': 'Authorization algorithms',
      'ov.algo.desc': 'Implemented request path: on-chain evaluation, rule checks, risk budget admission, windowed streaming, and continuous revocation',
      'ov.algo.phase1': 'Phase 1 — Access Evaluation',
      'ov.algo.phase2': 'Phase 2 — BV-GCA Streaming',
      'ov.algo.phase3': 'Phase 3 — TRT-BL Budget Control',
      'ov.algo.phase4': 'Phase 4 — CAAR Evidence',

      /* ---- Overview BV-GCA ---- */
      'ov.bvgca.title': 'BV-GCA framework',
      'ov.bvgca.desc': 'Blockchain-Verified Graduated Continuous Authorization — proposed framework architecture with RGCA, risk budget, cluster risk, and CAAR components',
      'ov.bvgca.flowTitle': 'Access decision flow',
      'ov.bvgca.flowDesc': 'From raw browser context to risk-graduated data delivery',
      'ov.bvgca.trtblTitle': 'TRT-BL Bounded Streaming',
      'ov.bvgca.trtblDesc': 'Trust-Rewarded Throughput Allocation under Bounded Leakage: the implemented formula that turns margin, file size, trust, and stable checks into a byte window',
      'ov.bvgca.highRisk': 'HIGH-RISK (m < 0.1)',
      'ov.bvgca.medium': 'MEDIUM (0.1 ≤ m < 0.3)',
      'ov.bvgca.lowRisk': 'LOW-RISK (m ≥ 0.3)',

      /* ---- Overview Context Model ---- */
      'ov.context.title': 'Context model',
      'ov.context.desc': 'C = (C_S, C_E, C_R, C_O) — four-dimensional context representation',
      'ov.context.cs': 'C_S — Subject',
      'ov.context.cs.desc': 'User identity & history',
      'ov.context.ce': 'C_E — Environment',
      'ov.context.ce.desc': 'Auto-collected from browser',
      'ov.context.cr': 'C_R — Resource',
      'ov.context.cr.desc': 'File sensitivity & policy',
      'ov.context.co': 'C_O — Object',
      'ov.context.co.desc': 'Resource properties & risk',

      /* ---- Overview Improvements ---- */
      'ov.improve.title': 'Implemented runtime improvements',
      'ov.improve.desc': 'Gateway-side controls added around the O(1) chaincode decision path',
      'ov.improve.item1': 'Continuous T_req',
      'ov.improve.item1.desc': 'Smooth cos² temporal decay replacing binary on/off. Working hours with gradual falloff — no abrupt cliff at boundaries.',
      'ov.improve.item2': 'T_sub Evolution (EMA)',
      'ov.improve.item2.desc': 'Trust evolves dynamically: T_sub(n+1) = T_sub(n) + γ×(outcome - T_sub(n)). Good sessions build trust, revocations erode it.',
      'ov.improve.item3': 'Object Risk Thresholding',
      'ov.improve.item3.desc': 'C_O raises P_req when files are large, frequently accessed, or recently uploaded. The effective threshold is sent to chaincode as P_eff.',
      'ov.improve.item4': 'CSRP Cluster Risk',
      'ov.improve.item4.desc': 'Revocations are recorded per subnet. Related active sessions receive a margin penalty and reset their acceleration when the shared network becomes risky.',
      'ov.improve.item5': 'Budgeted Delivery',
      'ov.improve.item5.desc': 'RiskBudgetService enforces daily per-user/file exposure. Soft limit forces HIGH-RISK streaming; hard limit denies access until reset.',

      /* ---- Overview Security ---- */
      'ov.sec.title': 'Security hardening',
      'ov.sec.desc': 'Defense-in-depth currently present in the gateway, oracle, frontend, storage, and deployment configuration',
      'ov.sec.identity': 'Identity and Account Protection',
      'ov.sec.gateway': 'Gateway, Oracle, and Chain Trust',
      'ov.sec.storage': 'Storage and Delivery Enforcement',
      'ov.sec.deployment': 'Deployment and Browser Surface',

      /* ---- Overview Evaluation ---- */
      'ov.eval.title': 'Performance evaluation',
      'ov.eval.desc': 'Hyperledger Caliper stress benchmark — 13 rounds, evaluateAccess plus CAAR receipt submission',
      'ov.eval.throughput': 'Chaincode throughput (TPS)',
      'ov.eval.latency': 'Max latency by round (ms)',
      'ov.eval.outcome': 'Transaction outcome',
      'ov.eval.metrics': 'End-to-end metrics',
      'ov.eval.accessSystem': 'Access the system →',

      /* ---- Overview Footer ---- */
      'ov.footer': 'Context Aware Access Control System v3.0 · Hyperledger Fabric · IPFS · Spring Boot · AES-256-GCM · BCrypt · Northwestern Polytechnical University · 2026',
    },

    zh: {
      /* ---- App / Brand ---- */
      'app.title': '情境自适应的人因数据使用控制系统',
      'app.subtitle': '情境自适应的人因数据使用控制系统',
      'app.adminPanel': '管理面板',
      'app.adminSubtitle': '情境自适应的人因数据使用控制系统 — 用户与文件管理',

      /* ---- Nav / Header ---- */
      'nav.admin': '管理',
      'nav.dashboard': '控制台',
      'nav.scenarios': '场景',
      'nav.myProfile': '我的资料',
      'nav.messages': '消息',
      'nav.systemOverview': '系统概览',
      'nav.scenarioDemo': '场景演示',
      'nav.logout': '退出登录',
      'nav.language': '语言',
      'nav.theme': '主题',

      /* ---- Login ---- */
      'login.title': '登录',
      'login.signup': '注册',
      'login.username': '用户名',
      'login.password': '密码',
      'login.btnLogin': '登录',
      'login.btnCreate': '创建账户',
      'login.placeholder.user': '请输入用户名',
      'login.placeholder.pass': '请输入密码',
      'login.captchaRequired': '需要验证码验证',
      'login.resetPassword': '使用管理员重置码重置密码',
      'login.totpTitle': '双因素认证',
      'login.totpDesc': '请输入身份验证器应用中的 6 位验证码',
      'login.totpVerify': '验证',
      'login.totpBack': '← 返回登录',
      'login.displayName': '显示名称',
      'login.placeholder.displayName': '您的全名',
      'login.placeholder.signupUser': '选择一个用户名',
      'login.placeholder.signupPass': '至少8个字符，混合类型',
      'login.placeholder.confirmPass': '再次输入密码',
      'login.confirmPassword': '确认密码',
      'login.email': '邮箱',
      'login.emailRequired': '（必填）',
      'login.phone': '电话',
      'login.phoneOptional': '（选填）',
      'login.resetSectionTitle': '使用重置码重置密码',
      'login.resetSectionDesc': '有管理员给的重置码？在此输入。',
      'login.resetCode': '重置码',
      'login.resetCodePlaceholder': '来自管理员的8位重置码',
      'login.resetNewPass': '新密码',
      'login.resetBtn': '设置新密码',
      'login.verifyEmailTitle': '请查收邮件',
      'login.verifyEmailMsg': '我们已向您的邮箱发送了一封验证邮件。请点击邮件中的链接验证您的账户。',
      'login.resendEmail': '重新发送邮件',
      'login.enterCode': '输入验证码',
      'login.phoneCodeMsg': '我们已向您的手机发送了 6 位验证码。',
      'login.btnVerify': '验证',
      'login.resendCode': '重新发送验证码',
      'login.waitingApproval': '等待管理员审批',
      'login.approvalMsg': '您的申请已在管理面板中可见，审批后即可登录。',
      'login.backToLogin': '返回登录',

      /* ---- Password rules ---- */
      'pwd.ruleLength': '至少 8 个字符',
      'pwd.ruleMix': '包含大写、小写、数字和符号',

      /* ---- Auth info box ---- */
      'auth.info': '访问文件时系统会自动收集您的上下文信息。角色和信任等级由系统管理员管理。',
      'auth.gateway': '网关',
      'auth.oracle': '预言机',
      'auth.storage': '存储',
      'auth.gatewayDesc': '策略已执行',
      'auth.oracleDesc': '链上已验证',
      'auth.storageDesc': 'IPFS 已加密',
      'auth.flow01': '身份认证',
      'auth.flow01Detail': 'BCrypt + 验证码',
      'auth.flow02': '上下文评估',
      'auth.flow02Detail': '设备、网络、信任',
      'auth.flow03': '流式传输文件',
      'auth.flow03Detail': 'RGCA 会话监控',

      /* ---- Dashboard ---- */
      'dash.envContext': '环境上下文（C_E）',
      'dash.autoCollected': '自动采集',
      'dash.subjContext': '主体上下文（C_S）',
      'dash.fromLogin': '来自登录',
      'dash.resContext': '资源上下文（C_R）',
      'dash.fromServer': '来自服务端',
      'dash.fileToAccess': '选择文件',
      'dash.searchFiles': '搜索文件...',
      'dash.loadingFiles': '正在加载文件...',
      'dash.sLevel': '敏感等级（服务端设定）',
      'dash.pReq': '准入阈值（服务端设定）',
      'dash.objContext': 'C_O — 对象上下文（自动）',
      'dash.refreshContext': '刷新上下文',
      'dash.requestAccess': '请求访问',
      'dash.publishFile': '发布文件',
      'dash.requiresApproval': '需审批',
      'dash.uploadFile': '上传到 IPFS',
      'dash.sensitivity': '敏感度（0.1 - 1.0）',
      'dash.description': '描述',
      'dash.file': '文件',
      'dash.accessRules': '访问规则（可选）',
      'dash.ruleOrg': '所属组织：',
      'dash.ruleOrgPlaceholder': '例如：西工大（留空=不限）',
      'dash.ruleMaxAccess': '每日最大访问次数：',
      'dash.ruleMinTrust': '最低信任度（T_sub）：',
      'dash.riskInspector': '风险检查器',
      'dash.selection': '选择',
      'dash.noRequest': '暂无访问请求',
      'dash.noRequestDesc': '请从左侧选择一个文件并点击"请求访问"。环境上下文将自动采集。',
      'dash.requestLog': '请求日志',
      'dash.clear': '清空',
      'dash.systemReady': '系统就绪，等待请求...',
      'dash.accesses': '访问次数',
      'dash.fileSize': '文件大小',
      'dash.rules': '规则',
      'dash.roleTrustDesc': '角色与信任由管理员分配',
      'dash.processing': '处理中...',
      'dash.gatewayStatus': '已连接',
      'dash.gatewayOffline': '离线',
      'dash.checking': '检测中...',

      /* ---- Risk Inspector ---- */
      'ri.user': '用户',
      'ri.role': '角色待定',
      'ri.trust': 'T_sub',
      'ri.subjectTrust': '主体信任',
      'ri.device': 'D_sec',
      'ri.deviceScore': '设备评分',
      'ri.network': 'N_status',
      'ri.networkScore': '网络评分',
      'ri.slevel': 'S_level',
      'ri.resourceClass': '资源等级',
      'ri.preq': 'P_req',
      'ri.effectiveThreshold': '有效阈值',
      'ri.rgca': 'RGCA',
      'ri.noSession': '无会话',
      'ri.margin': '安全裕度',
      'ri.marginDesc': 'DT - P_eff',
      'ri.admissionMargin': '准入裕度',
      'ri.waiting': '等待中',
      'ri.selectFile': '选择一个文件来查看主体信任、设备/网络上下文、资源敏感度和策略阈值的组合情况。',

      /* ---- Context labels ---- */
      'ctx.ip': 'IP 地址',
      'ctx.timestamp': '时间戳',
      'ctx.timezone': '时区',
      'ctx.network': '网络',
      'ctx.platform': '平台',
      'ctx.userAgent': '用户代理',
      'ctx.screen': '屏幕',
      'ctx.language': '语言',
      'ctx.colorDepth': '色彩深度',
      'ctx.touch': '触控',
      'ctx.user': '用户',
      'ctx.level': '等级',
      'ctx.threshold': '阈值',

      /* ---- Admin ---- */
      'admin.securityOps': '安全运维',
      'admin.opsDesc': '一览用户、注册表、异常、活跃会话和近期决策的整体态势。',
      'admin.pendingUsers': '待审批用户',
      'admin.approvalQueue': '审批队列',
      'admin.pendingFiles': '待审批文件',
      'admin.highSensitivity': '高敏文件',
      'admin.lowTrust': '低信任用户',
      'admin.denyRevoke': '拒绝/撤销',
      'admin.anomalies': '异常告警',
      'admin.unreviewed': '未审核',
      'admin.liveControlPath': '实时控制路径',
      'admin.visualState': '管理控制台的实时状态视图。',
      'admin.gatewayHealth': '网关健康',
      'admin.oracleBridge': 'Oracle 桥接',
      'admin.registry': '注册表',
      'admin.anomalyDetector': '异常检测器',
      'admin.checking': '检测中',
      'admin.standby': '待命',
      'admin.loading': '加载中',
      'admin.runTimeMonitor': '运行时监控',
      'admin.liveTopology': '实时拓扑 · 基准测试流',
      'admin.offline': '离线',
      'admin.resetView': '重置视图',
      'admin.clear': '清空',
      'admin.analyticsDashboard': '分析面板',
      'admin.refresh': '刷新',
      'admin.decisionChart': '决策统计（允许 vs 拒绝）',
      'admin.accessByFile': '按文件统计',
      'admin.activeUsers': '最活跃用户',
      'admin.activity24h': '24小时活动',
      'admin.registeredUsers': '注册用户',
      'admin.onlineNow': '当前在线',
      'admin.registeredFiles': '已注册文件',
      'admin.sortAZ': '排序：名称 A-Z',
      'admin.sortZA': '排序：名称 Z-A',
      'admin.sortRole': '排序：角色（高-低）',
      'admin.sortTrust': '排序：信任（高-低）',
      'admin.sortStatus': '排序：状态',
      'admin.sortNewest': '排序：最新',
      'admin.searchUsers': '搜索用户...',
      'admin.fileRegistry': '文件注册表',
      'admin.searchFiles': '搜索文件...',
      'admin.sortByStatus': '排序：状态',
      'admin.sortBySLevel': '排序：敏感等级',
      'admin.sortByPReq': '排序：准入阈值',
      'admin.sortByName': '排序：名称',
      'admin.sortByUploader': '排序：上传者',
      'admin.messages': '消息',
      'admin.newConv': '+ 新建',
      'admin.selectUser': '选择用户...',
      'admin.startConv': '开始对话',
      'admin.selectConv': '选择一个对话',
      'admin.selectConvHint': '从左侧选择一个用户来查看消息',
      'admin.typeReply': '输入回复...',
      'admin.send': '发送',
      'admin.anomalyAlerts': '异常告警列表',
      'admin.showReviewed': '显示已审核',
      'admin.reviewAll': '全部审核',
      'admin.deleteAll': '全部删除',
      'admin.accessAuditLog': '访问审计日志',
      'admin.filterAll': '全部',
      'admin.filterPendingUsers': '待审批用户',
      'admin.filterPendingFiles': '待审批文件',
      'admin.filterHighSensitivity': '高敏文件',
      'admin.filterLowTrust': '低信任用户',
      'admin.filterDenyRevoke': '拒绝/撤销',
      'admin.filterAnomalies': '异常告警',
      'admin.S3toS5': 'S3-S5 级对象',

      /* ---- Runtime Monitor Legend ---- */
      'rtm.okPermit': '正常 / 允许',
      'rtm.pending': '等待 / 评估中',
      'rtm.denyBlocked': '拒绝 / 拦截',
      'rtm.infoRegister': '信息 / 注册',
      'rtm.streaming': '流式传输中',
      'rtm.connecting': '连接中',

      /* ---- Status / Messages ---- */
      'status.authenticated': '已认证为',
      'status.permit': '允许',
      'status.deny': '拒绝',
      'status.blocked': '已拦截',
      'status.error': '错误',
      'status.revoked': '已撤销',
      'status.pending': '待处理',
      'status.approved': '已批准',
      'status.rejected': '已拒绝',
      'waiting': '等待请求...',

      /* ---- Errors ---- */
      'err.authRequired': '需要身份认证',
      'err.fileNotFound': '未找到文件',
      'err.serverError': '服务器错误',
      'err.networkError': '网络错误，请检查连接。',
      'err.unknown': '发生了未知错误',

      /* ---- Overview Nav ---- */
      'ov.nav.trustFlow': '信任流',
      'ov.nav.architecture': '系统架构',
      'ov.nav.algorithms': '授权算法',
      'ov.nav.bvgca': 'BV-GCA 框架',
      'ov.nav.context': '上下文模型',
      'ov.nav.metrics': '性能指标',

      /* ---- Overview Hero ---- */
      'ov.hero.title': '情境自适应的人因数据使用控制系统 / BV-GCA',
      'ov.hero.subtitle': '基于区块链的授权、加密IPFS文件交付、风险预算流式传输、持续撤销、异常拦截和可审计会话收据的已部署原型系统。',
      'ov.hero.meta': '网关 · 预言机 · Hyperledger Fabric · Kubo IPFS · 静态Web控制台',
      'ov.hero.metaAuthor': 'Matvei Prikhozhdenko · 指导教师：陈亚兴 · 西北工业大学',
      'ov.hero.encryptedIPFS': '加密 IPFS',
      'ov.hero.mathCaptcha': '数学验证码',
      'ov.hero.anomalyBlocking': '异常拦截',
      'ov.hero.accessSystem': '进入系统 →',
      'ov.hero.scenarioDemo': '场景演示',
      'ov.hero.trustFlow': '信任流 ↓',
      'ov.hero.scrollHint': '向下滚动探索 ↓',

      /* ---- Overview Trust Flow ---- */
      'ov.flow.title': '实时信任流',
      'ov.flow.desc': '部署请求生命周期的可视化路径。当 Fabric 或链码离线时，演示模式保持界面友好。',
      'ov.flow.ready': '就绪',
      'ov.flow.checking': '检测中',
      'ov.flow.local': '本地',
      'ov.flow.optional': '可选',
      'ov.flow.encrypted': '已加密',
      'ov.flow.browser.title': '浏览器',
      'ov.flow.browser.desc': '收集环境上下文，通过静态控制台提交令牌认证的请求。',
      'ov.flow.gateway.title': '网关',
      'ov.flow.gateway.desc': '认证用户、解析上下文、检查文件规则、打开会话并流式传输数据。',
      'ov.flow.oracle.title': '预言机',
      'ov.flow.oracle.desc': '签名并转发 evaluateAccess 和 CAAR 收据调用到可用的 Fabric 网络。',
      'ov.flow.fabric.title': 'Fabric 网络',
      'ov.flow.fabric.desc': '执行确定性的 PDP 路径。在可视化检查中，该层可保持离线状态。',
      'ov.flow.ipfs.title': 'IPFS 存储',
      'ov.flow.ipfs.desc': '按 CID 存储密文，网关在传输明文前强制执行授权检查。',

      /* ---- Overview Architecture ---- */
      'ov.arch.title': '系统架构',
      'ov.arch.desc': '当前已部署代码库：浏览器控制台、Spring Boot 网关、HMAC 保护的预言机、Fabric 链码和加密 IPFS 存储',
      'ov.arch.dataFlow': '数据流架构',
      'ov.arch.dataFlowDesc': '经过所有四层的请求生命周期，使用 HMAC 签名通道',

      /* ---- Overview Algorithms ---- */
      'ov.algo.title': '授权算法',
      'ov.algo.desc': '已实现的请求路径：链上评估、规则检查、风险预算准入、窗口化流式传输和持续撤销',
      'ov.algo.phase1': '阶段 1 — 访问评估',
      'ov.algo.phase2': '阶段 2 — BV-GCA 流式传输',
      'ov.algo.phase3': '阶段 3 — TRT-BL 预算控制',
      'ov.algo.phase4': '阶段 4 — CAAR 证据',

      /* ---- Overview BV-GCA ---- */
      'ov.bvgca.title': 'BV-GCA 框架',
      'ov.bvgca.desc': '区块链验证的渐进式持续授权——包含 RGCA、风险预算、集群风险和 CAAR 组件的提议框架架构',
      'ov.bvgca.flowTitle': '访问决策流程',
      'ov.bvgca.flowDesc': '从原始浏览器上下文到风险分级数据传输',
      'ov.bvgca.trtblTitle': 'TRT-BL 有界流式传输',
      'ov.bvgca.trtblDesc': '有界泄漏下的信任奖励吞吐量分配：将安全裕度、文件大小、信任和稳定检查转化为字节窗口的已实现公式',
      'ov.bvgca.highRisk': '高风险（m < 0.1）',
      'ov.bvgca.medium': '中风险（0.1 ≤ m < 0.3）',
      'ov.bvgca.lowRisk': '低风险（m ≥ 0.3）',

      /* ---- Overview Context Model ---- */
      'ov.context.title': '上下文模型',
      'ov.context.desc': 'C = (C_S, C_E, C_R, C_O) — 四维上下文表示',
      'ov.context.cs': 'C_S — 主体',
      'ov.context.cs.desc': '用户身份与历史',
      'ov.context.ce': 'C_E — 环境',
      'ov.context.ce.desc': '从浏览器自动采集',
      'ov.context.cr': 'C_R — 资源',
      'ov.context.cr.desc': '文件敏感度与策略',
      'ov.context.co': 'C_O — 对象',
      'ov.context.co.desc': '资源属性与风险',

      /* ---- Overview Improvements ---- */
      'ov.improve.title': '已实现的运行时改进',
      'ov.improve.desc': '在 O(1) 链码决策路径周围添加的网关侧控制',
      'ov.improve.item1': '连续 T_req',
      'ov.improve.item1.desc': '平滑 cos² 时间衰减替代二元开关。工作时间逐渐衰减——在边界处无突变。',
      'ov.improve.item2': 'T_sub 演化（EMA）',
      'ov.improve.item2.desc': '信任动态演化：T_sub(n+1) = T_sub(n) + γ×(结果 - T_sub(n))。良好会话增加信任，撤销降低信任。',
      'ov.improve.item3': '对象风险阈值调整',
      'ov.improve.item3.desc': '当文件较大、频繁访问或最近上传时，C_O 提高 P_req。有效阈值作为 P_eff 发送到链码。',
      'ov.improve.item4': 'CSRP 集群风险',
      'ov.improve.item4.desc': '撤销按子网记录。当共享网络变得危险时，相关活跃会话收到裕度惩罚并重置加速。',
      'ov.improve.item5': '预算化传输',
      'ov.improve.item5.desc': 'RiskBudgetService 强制执行每日每用户/文件暴露量。软限制强制使用高风险流式传输；硬限制拒绝访问直到重置。',

      /* ---- Overview Security ---- */
      'ov.sec.title': '安全加固',
      'ov.sec.desc': '网关、预言机、前端、存储和部署配置中当前存在的纵深防御',
      'ov.sec.identity': '身份与账户保护',
      'ov.sec.gateway': '网关、预言机和链上信任',
      'ov.sec.storage': '存储与传输执行',
      'ov.sec.deployment': '部署与浏览器攻击面',

      /* ---- Overview Evaluation ---- */
      'ov.eval.title': '性能评估',
      'ov.eval.desc': 'Hyperledger Caliper 压力基准测试——13 轮次，包括 evaluateAccess 和 CAAR 收据提交',
      'ov.eval.throughput': '链码吞吐量（TPS）',
      'ov.eval.latency': '各轮次最大延迟（ms）',
      'ov.eval.outcome': '交易结果',
      'ov.eval.metrics': '端到端指标',
      'ov.eval.accessSystem': '进入系统 →',

      /* ---- Overview Footer ---- */
      'ov.footer': '情境自适应的人因数据使用控制系统 v3.0 · Hyperledger Fabric · IPFS · Spring Boot · AES-256-GCM · BCrypt · 西北工业大学 · 2026',
    }
  };

  // ============================================================
  // STATE
  // ============================================================
  let currentLang = 'en';
  let fallbackLang = 'en';
  const listeners = [];

  function detectLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (_) {}
    // Detect browser language
    const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    if (browserLang.startsWith('zh')) return 'zh';
    return 'en';
  }

  currentLang = detectLanguage();

  // ============================================================
  // CORE API
  // ============================================================
  function t(key, fallback) {
    const langDict = LOCALE[currentLang] || LOCALE[fallbackLang];
    const result = langDict[key];
    if (result !== undefined && result !== null) return result;
    // Try fallback language
    if (currentLang !== fallbackLang) {
      const fallbackDict = LOCALE[fallbackLang];
      const fb = fallbackDict[key];
      if (fb !== undefined && fb !== null) return fb;
    }
    return fallback || key;
  }

  function setLanguage(lang) {
    if (lang !== 'en' && lang !== 'zh') return;
    if (lang === currentLang) return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    translateDOM();
    dispatchLanguageChanged(lang);
  }

  function getLanguage() {
    return currentLang;
  }

  function toggleLanguage() {
    setLanguage(currentLang === 'en' ? 'zh' : 'en');
  }

  function isChinese() {
    return currentLang === 'zh';
  }

  function addListener(fn) {
    listeners.push(fn);
    return function remove() {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function dispatchLanguageChanged(lang) {
    const event = new CustomEvent('caac-language-change', {
      detail: { language: lang, isChinese: lang === 'zh' }
    });
    window.dispatchEvent(event);
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (_) {}
    }
  }

  // ============================================================
  // DOM TRANSLATION
  // ============================================================
  function translateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const translation = t(key);
      if (translation !== key) {
        el.textContent = translation;
      }
    });

    // data-i18n-placeholder for input placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      const translation = t(key);
      if (translation !== key) {
        el.placeholder = translation;
      }
    });

    // data-i18n-title for title/tooltip attributes
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      const translation = t(key);
      if (translation !== key) {
        el.title = translation;
      }
    });

    // data-i18n-html for innerHTML (use with caution, translations are trusted)
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-html');
      if (!key) return;
      const translation = t(key);
      if (translation !== key) {
        el.innerHTML = translation;
      }
    });

    // data-i18n-value for input values
    document.querySelectorAll('[data-i18n-value]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-value');
      if (!key) return;
      const translation = t(key);
      if (translation !== key) {
        el.value = translation;
      }
    });

    // Update language toggle buttons
    document.querySelectorAll('[data-i18n-toggle]').forEach(function (btn) {
      btn.textContent = currentLang === 'en' ? 'EN' : '中文';
      btn.setAttribute('aria-label', currentLang === 'en'
        ? 'Switch to Chinese' : '切换到英文');
      btn.setAttribute('aria-pressed', currentLang === 'en' ? 'false' : 'true');
    });

    // Update html lang attribute
    document.documentElement.setAttribute('lang', currentLang);
  }

  // ============================================================
  // LANGUAGE TOGGLE BUTTON
  // ============================================================
  function installLanguageToggle() {
    if (document.querySelector('[data-i18n-toggle]')) {
      translateDOM();
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'i18n-toggle';
    btn.setAttribute('data-i18n-toggle', '');
    btn.textContent = currentLang === 'en' ? 'EN' : '中文';
    btn.setAttribute('aria-label', currentLang === 'en' ? 'Switch to Chinese' : '切换到英文');
    btn.onclick = function () {
      toggleLanguage();
    };
    document.body.appendChild(btn);
    translateDOM();
  }

  // ============================================================
  // INIT
  // ============================================================
  document.documentElement.setAttribute('lang', currentLang);

  // Install when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installLanguageToggle);
  } else {
    installLanguageToggle();
  }

  // Re-translate on mutation for dynamically added content
  // Debounced to avoid excessive work
  let debounceTimer = null;
  function debouncedTranslate() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      translateDOM();
      debounceTimer = null;
    }, 300);
  }

  // Run translate on dynamic content changes
  const observer = new MutationObserver(function () {
    debouncedTranslate();
  });
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }

  // ============================================================
  // EXPOSE GLOBALS (using same pattern as common.js)
  // ============================================================
  window.CAAC_I18N = {
    t: t,
    setLanguage: setLanguage,
    getLanguage: getLanguage,
    toggleLanguage: toggleLanguage,
    isChinese: isChinese,
    addListener: addListener,
    translateDOM: translateDOM,
    LOCALE: LOCALE
  };
  window.t = t; // convenience global
})();
