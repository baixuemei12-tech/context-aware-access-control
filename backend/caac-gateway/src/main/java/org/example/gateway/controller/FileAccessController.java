package org.example.gateway.controller;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.example.gateway.config.FileRegistry;
import org.example.gateway.model.AccessRequest;
import org.example.gateway.model.OracleResult;
import org.example.gateway.model.RawContext;
import org.example.gateway.service.AnomalyDetector;
import org.example.gateway.service.AuditService;
import org.example.gateway.service.ContextResolverService;
import org.example.gateway.service.IpfsService;
import org.example.gateway.service.LiveEventService;
import org.example.gateway.service.OracleClient;
import org.example.gateway.service.RevocationScheduler;
import org.example.gateway.service.RiskBudgetService;
import org.example.gateway.service.SessionManager;
import org.example.gateway.service.TotpService;
import org.example.gateway.service.UserService;
import org.example.gateway.model.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;


@RestController
@RequestMapping("/api/files")
public class FileAccessController {

    private final OracleClient oracleClient;
    private final SessionManager sessionManager;
    private final ContextResolverService contextResolver;
    private final FileRegistry fileRegistry;
    private final UserService userService;
    private final TotpService totpService;
    private final IpfsService ipfsService;
    private final AuditService auditService;
    private final AnomalyDetector anomalyDetector;
    private final RiskBudgetService riskBudgetService;
    private final RevocationScheduler revocationScheduler;
    private final LiveEventService liveEventService;
    private final ConcurrentHashMap<String, Object> budgetLocks = new ConcurrentHashMap<>();

    /**
     * BV-GCA budget constants — formerly static-final, now externalized so
     * the curve can be retuned without recompile (env CAAC_BUDGET_*, or
     * application.properties caac.budget.*). Defaults preserved.
     */
    @org.springframework.beans.factory.annotation.Autowired
    private org.example.gateway.config.CaacBudgetProperties budgetProps;

    @Value("${ipfs.gateway.url:http://127.0.0.1:8080/ipfs}")
    private String ipfsGatewayUrl;
    /**
     * Demo "secret file" CID. No default — must be supplied via env/property.
     * Previously fell back to a hardcoded Qm-CID; if that CID was ever populated
     * with a real sensitive file in any environment, the default became a
     * reachable backdoor. Empty value here triggers a startup check below.
     */
    @Value("${ipfs.secret.cid:}")
    private String secretFileCid;
    private static final int CHUNK_SIZE = 32;
    @Value("${stream.chunk.delay.ms:500}")
    private long baseChunkDelayMs;
    @Value("${app.prototype.endpoints.enabled:true}")
    private boolean prototypeEndpointsEnabled;
    @Value("${app.prototype.admin-only:true}")
    private boolean prototypeAdminOnly;

    public FileAccessController(OracleClient oracleClient,
                                SessionManager sessionManager,
                                ContextResolverService contextResolver,
                                FileRegistry fileRegistry,
                                UserService userService,
                                TotpService totpService,
                                IpfsService ipfsService,
                                AuditService auditService,
                                AnomalyDetector anomalyDetector,
                                RiskBudgetService riskBudgetService,
                                RevocationScheduler revocationScheduler,
                                LiveEventService liveEventService) {
        this.oracleClient = oracleClient;
        this.sessionManager = sessionManager;
        this.contextResolver = contextResolver;
        this.fileRegistry = fileRegistry;
        this.userService = userService;
        this.totpService = totpService;
        this.ipfsService = ipfsService;
        this.auditService = auditService;
        this.anomalyDetector = anomalyDetector;
        this.riskBudgetService = riskBudgetService;
        this.revocationScheduler = revocationScheduler;
        this.liveEventService = liveEventService;
    }

    // =================================================================
    // FILE REGISTRY ENDPOINT
    // =================================================================
    @GetMapping("/registry")
    public ResponseEntity<?> getRegistry(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        int userRSub = user.getRSub();
        double userTSub = user.getTSub();
        final int rSub = userRSub;
        final double tSub = userTSub;
        List<Map<String, Object>> files = fileRegistry.getAll().values().stream()
                .filter(f -> f.getSLevel() <= rSub)
                .filter(f -> f.getPReq() <= tSub)
                .map(FileRegistry.FileEntry::toUserMap)
                .collect(Collectors.toList());
        return ResponseEntity.ok(files);
    }

    // =================================================================
    // Evaluate Access (JSON, no file)
    // =================================================================
    @PostMapping("/{fileId}/web-access")
    public ResponseEntity<Map<String, Object>> webAccess(
            @PathVariable String fileId,
            @RequestBody RawContext rawContext,
            HttpServletRequest httpRequest,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("timestamp", LocalDateTime.now().toString());
        result.put("fileId", fileId);
        User authUser = userService.getUserByToken(authHeader);
        String username = authUser != null ? authUser.getUsername() : "anonymous";
        if (authUser == null) {
            result.put("status", "UNAUTHORIZED");
            result.put("reason", "Authentication required");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
        }

        // Check if user is blocked by anomaly detection (admin bypass)
        long blockedSeconds = (!userService.isAdmin(authUser)) ? anomalyDetector.isBlocked(username) : 0;
        if (blockedSeconds > 0) {
            result.put("status", "BLOCKED");
            result.put("reason", "Downloads temporarily suspended due to anomalous access pattern. "
                    + "Try again in " + blockedSeconds + " seconds.");
            result.put("blockedFor", blockedSeconds);
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(result);
        }

        FileRegistry.FileEntry fileEntry = fileRegistry.get(fileId);
        if (fileEntry == null) {
            result.put("status", "ERROR");
            result.put("reason", "File '" + fileId + "' not found in registry.");
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(result);
        }

        String clientIp = extractClientIp(httpRequest);
        System.out.println("\n========================================");
        System.out.println("[PEP-Web] Incoming web access request");
        System.out.println("[PEP-Web] File: " + fileId + " | IP: " + clientIp);
        System.out.println("[PEP-Web] Network: " + rawContext.getNetworkType()
                + " | Platform: " + rawContext.getPlatform()
                + " | Screen: " + rawContext.getScreenWidth() + "x" + rawContext.getScreenHeight());
        System.out.println("========================================");

        // ============================================================
        // CSRP cluster-risk auto-block: if this client's /24 subnet has been
        // hard-blocked (sustained R_N > threshold), refuse before doing any
        // oracle work or context resolution. Audited as DENY for forensics.
        // ============================================================
        String subnet = clientIp != null && clientIp.contains(".")
                ? clientIp.substring(0, clientIp.lastIndexOf('.') + 1) : clientIp;
        if (revocationScheduler.isSubnetBlocked(subnet)) {
            long expiry = revocationScheduler.getSubnetBlockExpiry(subnet);
            long remainingMin = Math.max(0, (expiry - System.currentTimeMillis()) / 60000);
            result.put("status", "DENIED");
            result.put("reason", "Subnet auto-blocked due to sustained cluster risk. Try again in "
                    + remainingMin + " min.");
            auditService.log(username, fileId, "DENY",
                    0.0, 0.0, fileEntry.getPReq(), 0,
                    clientIp, rawContext.getNetworkType(), rawContext.getPlatform(),
                    null, authUser.getRSub(), fileEntry.getSLevel());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
        }

        // ============================================================
        // C_O — Object Context
        // ============================================================
        double oRisk = contextResolver.computeObjectRisk(
                fileEntry.getAccessCount(), fileEntry.getFileSize(),
                fileEntry.getUploadedAtStr());
        double pEff = contextResolver.computeEffectiveThreshold(fileEntry.getPReq(), oRisk);

        // Resolve raw context into scores (creates the AccessRequest)
        AccessRequest request = contextResolver.resolve(rawContext, clientIp, authUser);
        request.setSLevel(String.valueOf(fileEntry.getSLevel()));
        request.setPReq(String.valueOf(pEff));

        System.out.println("[PEP-Web] C_O: accessCount=" + fileEntry.getAccessCount()
                + " | fileSize=" + fileEntry.getFileSize()
                + " | O_risk=" + String.format("%.4f", oRisk)
                + " | P_req=" + fileEntry.getPReq()
                + " | P_eff=" + String.format("%.4f", pEff));

        // Applying evolved T_sub if available
        String userId = authUser.getUsername();
        double baseTSub;
        try { baseTSub = Double.parseDouble(request.getTSub()); } catch (Exception e) { baseTSub = 0.7; }
        double evolvedTSub = sessionManager.getEvolvedTSub(userId, baseTSub);
        request.setTSub(String.valueOf(evolvedTSub));
        System.out.println("[PEP-Web] T_sub evolved: " + baseTSub + " -> " + evolvedTSub);

        Map<String, String> resolvedScores = new LinkedHashMap<>();
        resolvedScores.put("L_trust", request.getLTrust());
        resolvedScores.put("N_status", request.getNStatus());
        resolvedScores.put("D_sec", request.getDSec());
        resolvedScores.put("T_req", request.getTReq());
        result.put("resolvedScores", resolvedScores);

        Map<String, String> rawContextEcho = new LinkedHashMap<>();
        rawContextEcho.put("clientIp", clientIp);
        rawContextEcho.put("networkType", rawContext.getNetworkType());
        rawContextEcho.put("platform", rawContext.getPlatform());
        rawContextEcho.put("screen", rawContext.getScreenWidth() + "x" + rawContext.getScreenHeight());
        rawContextEcho.put("timezone", rawContext.getTimezone());
        rawContextEcho.put("language", rawContext.getLanguage());
        result.put("rawContext", rawContextEcho);

        // Call Oracle to Chaincode (Algorithm 1)
        long startTime = System.currentTimeMillis();
        OracleResult oracleResult = oracleClient.evaluate(request);
        long latencyMs = System.currentTimeMillis() - startTime;
        result.put("decision", oracleResult.getDecision());
        result.put("latencyMs", latencyMs);
        result.put("dtScore", oracleResult.getDtScore());
        result.put("ceScore", oracleResult.getCeScore());
        result.put("tSub", evolvedTSub);
        result.put("sLevel", fileEntry.getSLevel());
        result.put("pReq", pEff);
        result.put("pReqBase", fileEntry.getPReq());
        result.put("pReqEffective", pEff);
        result.put("objectRisk", oRisk);
        result.put("accessCount", fileEntry.getAccessCount());
        result.put("fileSize", fileEntry.getFileSize());

        System.out.println("[PEP-Web] Decision: " + oracleResult + " | Latency: " + latencyMs + "ms");

        if (oracleResult.isDeny()) {
            result.put("status", "DENIED");
            result.put("reason", "DT_score=" + oracleResult.getDtScore() + " did not meet P_req=" + fileEntry.getPReq()
                    + ", or R_sub < S_level=" + fileEntry.getSLevel() + ".");
            auditService.log(username, fileId, "DENY",
                    oracleResult.getDtScore(), oracleResult.getCeScore(), fileEntry.getPReq(), 0,
                    clientIp, rawContext.getNetworkType(), rawContext.getPlatform(),
                    null, authUser.getRSub(), fileEntry.getSLevel());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
        }

        if (oracleResult.isError()) {
            // Always audit oracle errors so denials are forensically reconstructable.
            // Previously the gateway returned 503 silently, leaving no audit trail.
            auditService.log(username, fileId, "ERROR",
                    oracleResult.getDtScore(), oracleResult.getCeScore(), fileEntry.getPReq(), 0,
                    clientIp, rawContext.getNetworkType(), rawContext.getPlatform(),
                    null, authUser.getRSub(), fileEntry.getSLevel());
            result.put("status", "ERROR");
            result.put("reason", "CAAC Oracle unreachable. Zero-Trust default: DENY.");
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(result);
        }

        // ============================================================
        // Non-context rules check (C_R rules)
        // ============================================================
        String ruleViolation = checkFileRules(fileEntry, authUser);
        if (ruleViolation != null) {
            result.put("decision", "DENY");
            result.put("status", "DENIED");
            result.put("reason", ruleViolation);
            result.put("ruleViolation", true);
            auditService.log(username, fileId, "DENY", oracleResult.getDtScore(), oracleResult.getCeScore(),
                    pEff, 0, clientIp, rawContext.getNetworkType(), rawContext.getPlatform(), null,
                    authUser.getRSub(), fileEntry.getSLevel());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
        }

        // ============================================================
        // BV-GCA: Risk budget check — BEFORE session registration
        // Atomic with session registration to prevent TOCTOU race.
        // ============================================================
        long fileSize = fileEntry.getFileSize();
        boolean isTextFile = detectMimeType(fileId).startsWith("text/");
        double userTSub = authUser.getTSub();

        String budgetLockKey = username + "|" + fileId;
        Object budgetLock = budgetLocks.computeIfAbsent(budgetLockKey, k -> new Object());

        String budgetStatus;
        SessionManager.ActiveSession session;
        String sessionId;

        synchronized (budgetLock) {
            budgetStatus = riskBudgetService.checkBudget(username, fileId, userTSub, fileSize, isTextFile);

            if ("DENY".equals(budgetStatus)) {
                result.put("status", "DENIED");
                result.put("reason", "Risk budget exceeded for this file today");
                auditService.log(username, fileId, "DENY", oracleResult.getDtScore(), oracleResult.getCeScore(),
                        pEff, 0, clientIp, rawContext.getNetworkType(), rawContext.getPlatform(), null,
                        authUser.getRSub(), fileEntry.getSLevel());
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(result);
            }

            fileEntry.incrementAccessCount();
            fileRegistry.saveToDisk();

            sessionId = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
            session = sessionManager.register(sessionId, fileId, request, authUser.getUsername());
        }
        session.setScores(oracleResult.getDtScore(), oracleResult.getCeScore());
        double riskMargin = session.riskMargin();

        // If budget forces HIGH-RISK, override the margin-based tier
        if ("HIGH_RISK".equals(budgetStatus)) {
            riskMargin = Math.min(riskMargin, 0.05);
        }

        long budgetLimit = riskBudgetService.computeBudget(userTSub, fileSize, isTextFile);
        long budgetUsed = riskBudgetService.getCumulativeLeakage(username, fileId);
        session.setBudgetLimit(budgetLimit);
        session.setBudgetUsed(budgetUsed);

        result.put("status", "PERMIT");
        result.put("sessionId", sessionId);
        result.put("riskMargin", riskMargin);
        result.put("fileType", getFileExtension(fileId));

        // Delivery speed info
        String speedTier = riskMargin >= 0.3 ? "RGCA-LOW-RISK" : riskMargin >= 0.1 ? "RGCA-MEDIUM-RISK" : "RGCA-HIGH-RISK";
        long budget = computeWindowBudget(speedTier.replace("RGCA-", ""), fileEntry.getFileSize(), evolvedTSub, 0);
        result.put("deliverySpeed", speedTier);
        result.put("windowBudget", budget);
        result.put("deliveryMode", "windowed-budget");
        result.put("chunkSize", Math.min(8192L, Math.max(1L, budget)));
        result.put("chunkDelay", 0);

        System.out.println("[PEP-Web] GRANTED. Session: " + sessionId
                + " | DT=" + oracleResult.getDtScore()
                + " | margin=" + Math.round(riskMargin * 10000.0) / 10000.0);

        // Audit log
        auditService.log(username, fileId, "PERMIT",
                oracleResult.getDtScore(), oracleResult.getCeScore(),
                fileEntry.getPReq(), riskMargin,
                clientIp, rawContext.getNetworkType(), rawContext.getPlatform(),
                sessionId, authUser.getRSub(), fileEntry.getSLevel());

        List<AnomalyDetector.AnomalyAlert> newAlerts = anomalyDetector.recordAccess(
                username, fileEntry.getSLevel(), evolvedTSub);
        if (!newAlerts.isEmpty()) {
            System.out.println("[PEP-Web] Anomaly detected for " + username + ": " + newAlerts.size() + " alert(s)");
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Check non-context rules specified by the file uploader
     * Supported rules:
     * - require_2fa — user must have TOTP 2FA enabled
     * - require_org — user's organization must match
     * - max_daily_access — max times per user per day
     * - min_trust — minimum T_sub required
     */
    private String checkFileRules(FileRegistry.FileEntry fileEntry, User user) {
        if (fileEntry.getRulesJson() == null || fileEntry.getRulesJson().equals("[]"))
            return null;

        List<Map<String, Object>> rules;
        try {
            rules = new com.fasterxml.jackson.databind.ObjectMapper().readValue(fileEntry.getRulesJson(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>(){});
        } catch (Exception e) {
            return null;
        }

        for (Map<String, Object> rule : rules) {
            String type = String.valueOf(rule.get("type"));
            Object value = rule.get("value");
            switch (type) {
                case "require_org":
                    String reqOrg = String.valueOf(value).toLowerCase().trim();
                    String userOrg = (user.getOrganization() != null ? user.getOrganization() : "").toLowerCase().trim();
                    if (userOrg.isEmpty() || !userOrg.contains(reqOrg)) {
                        return "Rule violation: organization '" + value + "' required (yours: " + (userOrg.isEmpty() ? "not set" : userOrg) + ")";
                    }
                    break;
                case "max_daily_access":
                    int maxAccess = ((Number) value).intValue();
                    int todayCount = auditService.getUserFileAccessCountToday(user.getUsername(), fileEntry.getFileId());
                    if (todayCount >= maxAccess) {
                        return "Rule violation: max " + maxAccess + " accesses/day (used: " + todayCount + ")";
                    }
                    break;
                case "min_trust":
                    double minTrust = ((Number) value).doubleValue();
                    if (user.getTSub() < minTrust) {
                        return "Rule violation: min trust " + String.format("%.2f", minTrust)
                                + " required (yours: " + String.format("%.2f", user.getTSub()) + ")";
                    }
                    break;
                case "require_2fa":
                    boolean require2Fa = value == null
                            || !(String.valueOf(value).equalsIgnoreCase("false")
                            || String.valueOf(value).equals("0")
                            || String.valueOf(value).equalsIgnoreCase("no"));
                    if (require2Fa && !totpService.isEnabled(user.getUsername())) {
                        return "Rule violation: TOTP 2FA required for this file";
                    }
                    break;
            }
        }
        return null;
    }

    // =================================================================
    // Stream with Algorithm 2 + Risk-Proportional Delay
    // =================================================================
    @GetMapping("/sessions/{sessionId}/stream")
    public void streamFile(
            @PathVariable String sessionId,
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletRequest request,
            HttpServletResponse response) throws Exception {
        User requester = userService.getUserByToken(authHeader);
        if (requester == null) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"Authentication required\"}");
            return;
        }

        SessionManager.ActiveSession session = sessionManager.getSession(sessionId);
        if (session == null) {
            response.setStatus(HttpStatus.NOT_FOUND.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\": \"Session " + sessionId + " not found, expired, or already closed.\"}");
            return;
        }
        if (!session.isActive()) {
            response.setStatus(HttpStatus.GONE.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"Session is no longer active\"}");
            return;
        }
        boolean isOwner = requester.getUsername().equalsIgnoreCase(session.getOwnerUsername());
        if (!isOwner && !userService.isAdmin(requester)) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"Access denied: session ownership required\"}");
            return;
        }

        double margin = session.riskMargin();

        // BV-GCA: set network fingerprint for CSRP cluster risk
        // Fix #5 — previously "subnet|N_status" (e.g. "192.168.1.|0.62"),
        // which made two sessions on the same /24 with slightly different
        // N_status values land in DIFFERENT clusters, breaking CSRP
        // propagation by design rather than by Δt as we had assumed.
        // The cluster identity is the subnet. N_status is a per-session
        // signal, not a cluster coordinate — keep it out of the key.
        String netIp = request.getRemoteAddr();
        if (netIp == null) netIp = "unknown";
        String subnet = netIp.contains(".") ? netIp.substring(0, netIp.lastIndexOf('.') + 1) : netIp;
        session.setNetworkFingerprint(subnet);

        // RGCA file-adaptive windowed budget delivery
        String fileId = session.getFileId();
        String rgcaTier = margin >= 0.3 ? "LOW-RISK" : margin >= 0.1 ? "MEDIUM-RISK" : "HIGH-RISK";
        session.setRgcaTier(rgcaTier);
        response.setHeader("X-RGCA-Tier", rgcaTier);

        System.out.println("\n[PEP-Stream] Phase 2: Session " + sessionId);
        System.out.println("[PEP-Stream] DT_score=" + session.getDtScore()
                + " | P_req=" + session.getPReq()
                + " | margin=" + Math.round(margin * 10000.0) / 10000.0);
        System.out.println("[PEP-Stream] RGCA tier: " + rgcaTier + " | Windowed budget delivery ACTIVE");

        // Look for CID in the file registry. If the file isn't registered
        // we used to fall back to a single hardcoded "secret" CID; that's now
        // refused unless an explicit override is configured (ipfs.secret.cid).
        FileRegistry.FileEntry fileEntry = fileRegistry.get(session.getFileId());
        String fileCid = fileEntry != null ? fileEntry.getCid() : null;
        if (fileCid == null) {
            if (secretFileCid == null || secretFileCid.isBlank()) {
                response.setStatus(HttpStatus.NOT_FOUND.value());
                response.getWriter().write("File not registered and no fallback configured");
                return;
            }
            fileCid = secretFileCid;
        }
        String mimeType = detectMimeType(fileId);

        response.setStatus(HttpStatus.OK.value());
        response.setContentType(mimeType);
        response.setHeader("X-CAAC-Session-ID", sessionId);
        response.setHeader("X-CAAC-Algorithm2", "ACTIVE");
        response.setHeader("X-CAAC-File-Type", getFileExtension(fileId));
        response.setHeader("X-CAAC-DT-Score", String.valueOf(session.getDtScore()));
        response.setHeader("X-CAAC-Risk-Margin", String.valueOf(Math.round(margin * 10000.0) / 10000.0));
        response.setHeader("X-CAAC-Delivery-Mode", "windowed-budget");
        response.setHeader("Cache-Control", "no-cache");
        String safeFileName = fileId.replaceAll("[\\r\\n\"]", "_");
        response.setHeader("Content-Disposition", "inline; filename=\"" + safeFileName + "\"");

        byte[] fileData;
        try {
            if (ipfsService.hasEncryptionKey(fileId) || ipfsService.hasEncryptionKey(fileCid)) {
                fileData = ipfsService.downloadAndDecrypt(fileCid, fileId);
                System.out.println("[PEP-Stream v3] Decrypted file: " + fileId
                        + " (" + fileData.length + " bytes)");
            } else {
                String ipfsUrl = ipfsGatewayUrl + "/" + fileCid;
                HttpURLConnection conn = (HttpURLConnection) new URL(ipfsUrl).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(10000);
                conn.connect();

                if (conn.getResponseCode() != 200) {
                    response.setStatus(HttpStatus.INTERNAL_SERVER_ERROR.value());
                    response.getWriter().write("ERROR: IPFS fetch failed (HTTP " + conn.getResponseCode() + ")");
                    sessionManager.close(sessionId);
                    return;
                }

                try (InputStream in = conn.getInputStream();
                     java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) baos.write(buf, 0, n);
                    fileData = baos.toByteArray();
                }
                System.out.println("[PEP-Stream] Raw IPFS fetch (legacy): " + fileId + " (" + fileData.length + " bytes)");
            }
        } catch (Exception e) {
            response.setStatus(HttpStatus.INTERNAL_SERVER_ERROR.value());
            response.setContentType(MediaType.TEXT_PLAIN_VALUE);
            response.getWriter().write("ERROR: File fetch/decrypt failed: " + e.getMessage());
            sessionManager.close(sessionId);
            return;
        }

        try (OutputStream out = response.getOutputStream()) {
            long fileSizeBytes = fileData.length;
            session.setFileSize(fileSizeBytes);

            double sessionTSub;
            try { sessionTSub = Double.parseDouble(session.getContext().getTSub()); }
            catch (Exception e) { sessionTSub = 0.5; }
            int accelN = session.getStableCheckCount();

            long budget = computeWindowBudget(rgcaTier, fileSizeBytes, sessionTSub, accelN);
            session.setWindowBudget(budget);
            session.trackTierBound(budget);

            int totalBytes = 0;
            int offset = 0;
            int windowBytes = 0;
            int burstChunkSize = 8192;
            response.setHeader("X-CAAC-Window-Budget", String.valueOf(budget));
            response.setHeader("X-CAAC-Chunk-Size", String.valueOf(Math.min(burstChunkSize, Math.max(1L, budget))));
            response.setHeader("X-CAAC-Chunk-Delay", "0");

            String accelInfo = accelN > 0 ? " (n=" + accelN + ", ψ-accelerated)" : "";
            System.out.println("[PEP-Stream] Budget: " + budget + " bytes/window | File: " + fileSizeBytes + " bytes | Tier: " + rgcaTier + accelInfo);

            while (offset < fileData.length) {
                if (session.isRevoked()) {
                    String revMsg = "\n\n--- STREAM TERMINATED ---\n"
                            + "Access revoked by CAAC Algorithm 2.\n"
                            + "Reason: Context degradation detected mid-session.\n"
                            + "Session: " + sessionId + "\n"
                            + "Bytes delivered before revocation: " + totalBytes + "\n";
                    System.out.println("[PEP-Stream] *** REVOCATION ***");
                    System.out.println("[PEP-Stream] Session: " + sessionId + " | Bytes: " + totalBytes);
                    out.write(revMsg.getBytes());
                    out.flush();
                    return;
                }

                if (!session.hasWindowBudget()) {
                    session.markWindowBudgetExhausted();

                    OracleResult evalResult = oracleClient.evaluate(session.getContext());
                    if (evalResult.isDeny()) {
                        session.revoke();
                        revocationScheduler.recordNetworkRevocation(session);
                        String revMsg = "\n\n--- STREAM TERMINATED ---\n"
                                + "Access revoked by CAAC Algorithm 2.\n"
                                + "Reason: Context degradation detected mid-session.\n"
                                + "Session: " + sessionId + "\n"
                                + "Bytes delivered before revocation: " + totalBytes + "\n";
                        System.out.println("[PEP-Stream] *** REVOCATION (budget-eval) ***");
                        out.write(revMsg.getBytes());
                        out.flush();
                        return;
                    }

                    session.setScores(evalResult.getDtScore(), evalResult.getCeScore());
                    double newMargin = evalResult.getDtScore() - session.getPReq();
                    String newTier = newMargin >= 0.3 ? "LOW-RISK" : newMargin >= 0.1 ? "MEDIUM-RISK" : "HIGH-RISK";
                    session.setRgcaTier(newTier);

                    double newTSub;
                    try { newTSub = Double.parseDouble(session.getContext().getTSub()); }
                    catch (Exception e) { newTSub = 0.5; }
                    int newAccelN = session.getStableCheckCount();

                    long newBudget = computeWindowBudget(newTier, session.getFileSize(), newTSub, newAccelN);
                    session.resetWindow();
                    session.setWindowBudget(newBudget);
                    session.trackTierBound(newBudget);
                    windowBytes = 0;
                    budget = newBudget;
                    String newAccelInfo = newAccelN > 0 ? " (n=" + newAccelN + ", ψ-accelerated)" : "";
                    System.out.println("[PEP-Stream] Budget refreshed: " + newBudget + " bytes (tier=" + newTier + ", margin=" + Math.round(newMargin * 10000.0) / 10000.0 + ")" + newAccelInfo + " — resuming");
                }

                int remaining = (int) Math.min(burstChunkSize, fileData.length - offset);
                long budgetLeft = session.getWindowBudget() - session.getWindowBytesDelivered();
                if (remaining > budgetLeft) remaining = (int) budgetLeft;

                out.write(fileData, offset, remaining);
                out.flush();
                response.flushBuffer();
                offset += remaining;
                totalBytes += remaining;
                windowBytes += remaining;
                session.addBytesDelivered(remaining);
            }

            System.out.println("[PEP-Stream] Stream completed. Session: " + sessionId + " | Bytes: " + totalBytes);
        } finally {
            // BV-GCA: record delivery in risk budget
            String owner = session.getOwnerUsername();
            if (owner != null) {
                riskBudgetService.recordDelivery(owner, fileId, session.getBytesDelivered());
            }
            sessionManager.close(sessionId);
        }
    }

    /**
     * BV-GCA v2: Trust-Rewarded Throughput Allocation under Bounded Leakage
     *
     * L(m, S, T_sub, n) = min( B_max(m), mu(m) * (1 + kappa * T_sub) * S^theta(m) * (1 + psi(m) * n) )
     *
     * Every constant is derived from a stated policy requirement:
     *   theta(m) — from "doubling file size at most A-multiplies leakage"  → theta = log2(A)
     *   mu(m)    — from calibration policy point (1MB file at default trust → L0(m))
     *   kappa    — from "max trust earns at most 2x throughput"            → kappa = 1.0
     *   psi(m)   — from "5 stable polls reaches 80% of B_max"             → derived per tier
     *
     * Theorems preserved:
     *   Theorem 1  — L <= B_max(m) (min clamp)
     *   Theorem 1a — sub-linear file-size scaling (ratio <= (S2/S1)^theta)
     *   Theorem 1b — bounded trust differential (ratio <= 1 + kappa)
     *   Theorem 1c — acceleration progression (L(n) >= L(0) * (1 + psi*n))
     *   Theorem 2  — cumulative budget unchanged
     *   Theorem 3  — CAAR receipt compliance unchanged
     */
    private long computeWindowBudget(String tier, long fileSize, double tSub, int n) {
        String t = tier.replace("-RISK", "");
        double mu, theta, psi;
        long bMax;
        switch (t) {
            case "LOW":    mu = budgetProps.getMuLow();    theta = budgetProps.getThetaLow();    psi = budgetProps.getPsiLow();    bMax = budgetProps.getBMaxLowBytes();    break;
            case "MEDIUM": mu = budgetProps.getMuMedium(); theta = budgetProps.getThetaMedium(); psi = budgetProps.getPsiMedium(); bMax = budgetProps.getBMaxMediumBytes(); break;
            case "HIGH":   mu = budgetProps.getMuHigh();   theta = budgetProps.getThetaHigh();   psi = budgetProps.getPsiHigh();   bMax = budgetProps.getBMaxHighBytes();   break;
            default:       mu = budgetProps.getMuHigh();   theta = budgetProps.getThetaHigh();   psi = budgetProps.getPsiHigh();   bMax = budgetProps.getBMaxHighBytes();   break;
        }
        double raw = mu * (1.0 + budgetProps.getKappa() * tSub) * Math.pow((double) fileSize, theta) * (1.0 + psi * n);
        long budget = (long) raw;
        return Math.min(bMax, Math.max(1L, budget));
    }

    private long computeWindowBudget(String tier, long fileSize) {
        return computeWindowBudget(tier, fileSize, 0.5, 0);
    }

    // =================================================================
    // ORIGINAL ENDPOINT (Part 1)
    // =================================================================
    @GetMapping("/{fileId}")
    public ResponseEntity<Map<String, Object>> accessFileLegacy(
            @PathVariable String fileId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("error", "Legacy endpoint disabled. Use POST /api/files/{fileId}/web-access.");
        result.put("fileId", fileId);
        return ResponseEntity.status(HttpStatus.GONE).body(result);
    }

    // =================================================================
    // DEMO & HEALTH
    // =================================================================
    @PostMapping("/sessions/{sessionId}/degrade")
    public ResponseEntity<String> degradeSession(
            @PathVariable String sessionId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!prototypeEndpointsEnabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("{\"error\":\"Prototype endpoint disabled\"}");
        }
        User requester = userService.getUserByToken(authHeader);
        if (requester == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("{\"error\":\"Authentication required\"}");
        }
        if (prototypeAdminOnly && !userService.isAdmin(requester)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("{\"error\":\"Admin access required\"}");
        }
        SessionManager.ActiveSession target = sessionManager.getSession(sessionId);
        if (target == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("{\"error\": \"Session " + sessionId + " not found\"}");
        }
        if (!target.isActive()) {
            return ResponseEntity.status(HttpStatus.GONE).body("{\"error\": \"Session " + sessionId + " is not active\"}");
        }

        // Degrade context scores - simulate compromised environment
        // L_trust=0.1 (untrusted location), N_status=0.1 (public wifi),
        // D_sec=0.1 (tampered device), T_req=0.0 (outside working hours)
        target.getContext().setLTrust("0.1");
        target.getContext().setNStatus("0.1");
        target.getContext().setDSec("0.1");
        target.getContext().setTReq("0.0");

        OracleResult result = oracleClient.evaluate(target.getContext());
        target.setScores(result.getDtScore(), result.getCeScore());
        if (result.isDeny()) {
            target.revoke();
            revocationScheduler.recordNetworkRevocation(target);
            System.out.println("[BV-GCA Demo] Session " + sessionId + " IMMEDIATELY REVOKED after context degradation (DT=" + result.getDtScore() + ")");
            return ResponseEntity.ok("{\"sessionId\":\"" + sessionId + "\",\"action\":\"revoked\","
                    + "\"dtScore\":\"" + result.getDtScore() + "\","
                    + "\"note\":\"Session revoked immediately — DT below threshold\"}");
        }

        System.out.println("[BV-GCA Demo] Context degraded for session " + sessionId + " — Algorithm 2 will detect on next poll cycle");
        return ResponseEntity.ok("{\"sessionId\":\"" + sessionId  + "\",\"action\":\"context_degraded\","
                + "\"note\":\"Algorithm 2 will revoke on next polling cycle (Δt-dependent)\"}");
    }

    /**
     * Query on-chain CAAR receipt by session ID.
     * Receipts are stored under hashed session IDs, so we derive the hash here.
     */
    @GetMapping("/sessions/{sessionId}/receipt")
    public ResponseEntity<?> querySessionReceipt(
            @PathVariable String sessionId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User requester = userService.getUserByToken(authHeader);
        if (requester == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        if (!userService.isAdmin(requester)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }

        String sessionHash = SessionManager.sha256Full(sessionId);
        try {
            String receipt = oracleClient.queryReceipt(sessionHash);
            if (receipt == null || receipt.isBlank() || "NOT_FOUND".equalsIgnoreCase(receipt.trim())) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                        "status", "NOT_FOUND",
                        "sessionId", sessionId,
                        "sessionHash", sessionHash
                ));
            }
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("status", "OK");
            result.put("sessionId", sessionId);
            result.put("sessionHash", sessionHash);
            result.put("receipt", receipt);
            return ResponseEntity.ok(result);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of(
                    "error", "Receipt query failed",
                    "detail", e.getMessage(),
                    "sessionId", sessionId,
                    "sessionHash", sessionHash
            ));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return ResponseEntity.ok("{\"status\":\"UP\",\"version\":\"2.2\","
                + "\"registeredFiles\":" + fileRegistry.getAll().size()
                + ",\"pendingFiles\":" + fileRegistry.getPendingCount()
                + ",\"activeSessions\":" + sessionManager.getActiveCount() + "}");
    }

    @GetMapping("/context/client-ip")
    public ResponseEntity<Map<String, String>> clientIp(HttpServletRequest request) {
        return ResponseEntity.ok(Map.of("ip", extractClientIp(request)));
    }

    @PostMapping("/reset-trust")
    public ResponseEntity<String> resetTrust(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (!prototypeEndpointsEnabled) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body("{\"error\":\"Prototype endpoint disabled\"}");
        }
        User requester = userService.getUserByToken(authHeader);
        if (requester == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("{\"error\":\"Authentication required\"}");
        }
        if (prototypeAdminOnly && !userService.isAdmin(requester)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("{\"error\":\"Admin access required\"}");
        }
        sessionManager.resetAllTrust();
        return ResponseEntity.ok("{\"action\":\"All T_sub values reset to defaults\"}");
    }

    // =================================================================
    // ADMIN PREVIEW
    // =================================================================
    @GetMapping("/preview/{fileName}")
    public void previewFile(@PathVariable String fileName, @RequestParam String cid,
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletResponse response) throws Exception {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            response.setStatus(HttpStatus.FORBIDDEN.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"error\":\"Admin access required\"}");
            return;
        }

        String mimeType = detectMimeType(fileName);
        byte[] fileBytes;

        if (ipfsService.hasEncryptionKey(fileName) || ipfsService.hasEncryptionKey(cid)) {
            fileBytes = ipfsService.downloadAndDecrypt(cid, fileName);
            System.out.println("[Preview] Decrypted preview: " + fileName + " (CID=" + cid + ")");
        } else {
            String ipfsUrl = ipfsGatewayUrl + "/" + cid;
            HttpURLConnection conn = (HttpURLConnection) new URL(ipfsUrl).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(30000);
            conn.connect();

            if (conn.getResponseCode() != 200) {
                response.setStatus(HttpStatus.NOT_FOUND.value());
                response.getWriter().write("File not found on IPFS");
                return;
            }

            try (InputStream in = conn.getInputStream();
                 java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
                fileBytes = baos.toByteArray();
            }
        }

        response.setContentType(mimeType);
        String safeFileName = fileName.replaceAll("[\\r\\n\"]", "_");
        String ext = safeFileName.contains(".") ? safeFileName.substring(safeFileName.lastIndexOf('.') + 1).toLowerCase() : "";
        boolean canInline = Set.of("txt", "csv", "json", "log", "md", "pdf", "png", "jpg", "jpeg", "gif").contains(ext);
        if (canInline) {
            response.setHeader("Content-Disposition", "inline; filename=\"" + safeFileName + "\"");
            response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'");
        } else {
            response.setHeader("Content-Disposition", "attachment; filename=\"" + safeFileName + "\"");
        }
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "no-cache");
        try (OutputStream out = response.getOutputStream()) {
            out.write(fileBytes);
            out.flush();
        }
    }

    /**
     * Policy-conflict detector. Returns a human-readable explanation of why a
     * rule set is impossible to satisfy, or null if it's fine. Catches the
     * common admin foot-guns:
     *   - min_trust > 0.95 (no user starts there + recovery is slow)
     *   - max_daily_access < 1
     *   - require_2fa AND min_trust > 0 — fine, but require_org="" + min_trust > 1.0 isn't
     *   - sLevel range (0.1..1.0) sanity vs suggestedSLevel
     */
    private String detectPolicyConflict(String rulesJson, double suggestedSLevel) {
        if (suggestedSLevel < 0.1 || suggestedSLevel > 1.0) {
            return "S_level " + suggestedSLevel + " is out of range (0.1..1.0)";
        }
        if (rulesJson == null || rulesJson.isBlank() || "[]".equals(rulesJson.trim())) {
            return null;
        }
        // Lightweight scan — we don't pull in a JSON lib here; the rule schema
        // is shallow (key:value pairs) and a few targeted checks catch the
        // 90% of admin mistakes.
        String j = rulesJson.toLowerCase();
        try {
            // min_trust > 1 or > 0.95 (impractical)
            int mt = j.indexOf("\"min_trust\"");
            if (mt < 0) mt = j.indexOf("min_trust");
            if (mt >= 0) {
                int colon = j.indexOf(':', mt);
                if (colon > 0) {
                    String tail = j.substring(colon + 1, Math.min(colon + 20, j.length()));
                    String num = tail.replaceAll("[^0-9.]", " ").trim().split("\\s+")[0];
                    if (!num.isEmpty()) {
                        double v = Double.parseDouble(num);
                        if (v > 1.0) return "min_trust=" + v + " is greater than the cap (1.0)";
                        if (v > 0.95) return "min_trust=" + v + " is effectively unsatisfiable (cap is 1.0)";
                    }
                }
            }
            // max_daily_access < 1
            int md = j.indexOf("max_daily_access");
            if (md >= 0) {
                int colon = j.indexOf(':', md);
                if (colon > 0) {
                    String tail = j.substring(colon + 1, Math.min(colon + 20, j.length()));
                    String num = tail.replaceAll("[^0-9.\\-]", " ").trim().split("\\s+")[0];
                    if (!num.isEmpty()) {
                        double v = Double.parseDouble(num);
                        if (v < 1) return "max_daily_access=" + v + " forbids all access";
                    }
                }
            }
        } catch (RuntimeException ignored) {
            // Permissive: malformed JSON falls through to the existing flow,
            // which will error out at decode time with a clearer message.
        }
        return null;
    }

    // =================================================================
    // FILE UPLOAD
    // =================================================================
    @PostMapping("/upload")
    public ResponseEntity<Map<String, Object>> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "sLevel", defaultValue = "0.5") double suggestedSLevel,
            @RequestParam(value = "description", defaultValue = "") String description,
            @RequestParam(value = "rules", defaultValue = "[]") String rulesJson,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        Map<String, Object> result = new LinkedHashMap<>();
        User user = userService.getUserByToken(authHeader);
        if (user == null) {
            result.put("error", "Authentication required");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(result);
        }

        if (file.isEmpty()) {
            result.put("error", "No file provided");
            return ResponseEntity.badRequest().body(result);
        }

        String filename = file.getOriginalFilename();
        if (filename == null || filename.trim().isEmpty()) filename = "upload.txt";
        filename = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (suggestedSLevel < 0.1 || suggestedSLevel > 1.0) suggestedSLevel = 0.5;
        if (description.trim().isEmpty()) description = "Uploaded by " + user.getUsername();

        // Policy-conflict detector: prevent saving a rule set whose intersection
        // with the user population is empty. min_trust > 0.95 + require_2fa is
        // a common foot-gun (no real user satisfies both at upload time).
        String conflict = detectPolicyConflict(rulesJson, suggestedSLevel);
        if (conflict != null) {
            result.put("error", "Policy conflict: " + conflict);
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(result);
        }
        try {
            byte[] bytes = file.getBytes();
            String cid = ipfsService.upload(filename, bytes);
            FileRegistry.FileEntry entry = fileRegistry.addPending(filename, cid, suggestedSLevel, description, user.getUsername());
            if (entry == null) {
                result.put("error", "A file with name '" + filename + "' already exists");
                return ResponseEntity.status(HttpStatus.CONFLICT).body(result);
            }
            entry.setRulesJson(rulesJson);
            entry.setFileSize(bytes.length);
            fileRegistry.saveToDisk();

            result.put("status", "pending");
            result.put("message", "File uploaded to IPFS. Awaiting admin approval");
            result.put("file", entry.toUserMap());
            liveEventService.publishFileChanged("FILE_UPLOADED", entry);
            return ResponseEntity.status(HttpStatus.CREATED).body(result);

        } catch (Exception e) {
            System.err.println("[Upload] Failed: " + e.getMessage());
            result.put("error", "Upload failed: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(result);
        }
    }

    // =================================================================
    // ADMIN: FILE MANAGEMENT
    // =================================================================
    @GetMapping("/admin/all")
    public ResponseEntity<?> adminListFiles(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        List<Map<String, Object>> files = fileRegistry.getAllAdmin().stream().map(FileRegistry.FileEntry::toMap).collect(Collectors.toList());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("totalFiles", files.size());
        result.put("pendingCount", fileRegistry.getPendingCount());
        result.put("files", files);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/admin/{fileId}/approve")
    public ResponseEntity<Map<String, Object>> approveFile(
            @PathVariable String fileId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        int finalSLevel = 1;
        if (body != null && body.containsKey("sLevel")) {
            try { finalSLevel = ((Number) body.get("sLevel")).intValue(); }
            catch (Exception e) { finalSLevel = 1; }
        }
        boolean ok = fileRegistry.approve(fileId, finalSLevel);
        if (!ok) {
            result.put("error", "File not found or not pending");
            return ResponseEntity.badRequest().body(result);
        }
        result.put("status", "approved");
        result.put("fileId", fileId);
        result.put("sLevel", finalSLevel);
        liveEventService.publishFileChanged("FILE_APPROVED", findAdminFile(fileId));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/admin/{fileId}/reject")
    public ResponseEntity<Map<String, Object>> rejectFile(
            @PathVariable String fileId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        boolean ok = fileRegistry.reject(fileId);
        if (!ok) {
            result.put("error", "File not found or not pending");
            return ResponseEntity.badRequest().body(result);
        }
        result.put("status", "rejected");
        result.put("fileId", fileId);
        liveEventService.publishFileChanged("FILE_REJECTED", findAdminFile(fileId));
        return ResponseEntity.ok(result);
    }

    @PostMapping("/admin/{fileId}/delete")
    public ResponseEntity<Map<String, Object>> deleteFile(
            @PathVariable String fileId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        FileRegistry.FileEntry deleted = findAdminFile(fileId);
        boolean ok = fileRegistry.delete(fileId);
        if (!ok) {
            result.put("error", "File not found");
            return ResponseEntity.badRequest().body(result);
        }
        result.put("status", "deleted");
        result.put("fileId", fileId);
        liveEventService.publishFileChanged("FILE_DELETED", deleted);
        return ResponseEntity.ok(result);
    }

    private FileRegistry.FileEntry findAdminFile(String fileId) {
        return fileRegistry.getAllAdmin().stream()
                .filter(entry -> fileId.equals(entry.getFileId()))
                .findFirst()
                .orElse(null);
    }

    @GetMapping("/by-user/{username}")
    public ResponseEntity<?> getFilesByUser(
            @PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User requester = userService.getUserByToken(authHeader);
        if (requester == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username"));
        }
        String normalized = username.toLowerCase();
        if (!requester.getUsername().equals(normalized) && !userService.isAdmin(requester)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Access denied"));
        }
        List<Map<String, Object>> files = fileRegistry.getByUser(normalized).stream()
                .map(userService.isAdmin(requester) ? FileRegistry.FileEntry::toMap : FileRegistry.FileEntry::toUserMap)
                .collect(Collectors.toList());
        return ResponseEntity.ok(Map.of("username", normalized, "files", files));
    }

    // =================================================================
    // ADMIN: BUDGET RESET (for benchmark recovery between E3 and E4/E5/E6)
    // =================================================================
    @PostMapping("/admin/budget/reset/{username}")
    public ResponseEntity<?> resetUserBudget(
            @PathVariable String username,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        if (!userService.isValidUsername(username)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid username"));
        }
        String normalized = username.toLowerCase();
        riskBudgetService.resetUserBudget(normalized);
        return ResponseEntity.ok(Map.of("status", "budget_reset", "username", normalized));
    }

    @PostMapping("/admin/file/reset-access/{fileId}")
    public ResponseEntity<?> resetFileAccessCount(
            @PathVariable String fileId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        User admin = userService.getUserByToken(authHeader);
        if (admin == null || !userService.isAdmin(admin)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin access required"));
        }
        FileRegistry.FileEntry entry = fileRegistry.getAllAdmin().stream()
                .filter(e -> fileId.equals(e.getFileId())).findFirst().orElse(null);
        if (entry == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "File not found"));
        }
        entry.setAccessCount(0);
        fileRegistry.saveToDisk();
        return ResponseEntity.ok(Map.of("status", "access_count_reset", "fileId", fileId));
    }

    // =================================================================
    // UTILITY
    // =================================================================
    private String extractClientIp(HttpServletRequest request) {
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        if (isTrustedProxy(remoteAddr)) {
            String forwarded = firstForwardedIp(request.getHeader("X-Forwarded-For"));
            if (forwarded != null) return forwarded;
            String realIp = normalizeIp(request.getHeader("X-Real-IP"));
            if (realIp != null) return realIp;
        }
        return remoteAddr != null ? remoteAddr : "";
    }

    private String firstForwardedIp(String xForwardedFor) {
        if (xForwardedFor == null || xForwardedFor.isBlank()) return null;
        String[] ips = xForwardedFor.split(",");
        if (ips.length == 0) return null;
        return normalizeIp(ips[0]);
    }

    private String normalizeIp(String ip) {
        if (ip == null) return null;
        String value = ip.trim();
        if (value.isEmpty()) return null;
        if (value.startsWith("[") && value.contains("]")) {
            value = value.substring(1, value.indexOf(']'));
        } else if (value.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+:\\d+$")) {
            value = value.substring(0, value.indexOf(':'));
        }
        return value.isEmpty() ? null : value;
    }

    private boolean isTrustedProxy(String ip) {
        if (ip == null || ip.isBlank()) return false;
        if ("127.0.0.1".equals(ip) || "::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip)) return true;
        if (ip.startsWith("10.") || ip.startsWith("192.168.")
                || ip.startsWith("::ffff:127.") || ip.startsWith("::ffff:10.") || ip.startsWith("::ffff:192.168.")) {
            return true;
        }
        if (ip.startsWith("172.") || ip.startsWith("::ffff:172.")) {
            String normalized = ip.startsWith("::ffff:") ? ip.substring("::ffff:".length()) : ip;
            String[] parts = normalized.split("\\.");
            if (parts.length >= 2) {
                try {
                    int second = Integer.parseInt(parts[1]);
                    return second >= 16 && second <= 31;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }

    private String getFileExtension(String filename) {
        if (filename == null) return "txt";
        int dot = filename.lastIndexOf('.');
        return dot >= 0 ? filename.substring(dot + 1).toLowerCase() : "txt";
    }

    private String detectMimeType(String filename) {
        String ext = getFileExtension(filename);
        switch (ext) {
            case "pdf": return "application/pdf";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "doc": return "application/msword";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "xls": return "application/vnd.ms-excel";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            case "ppt": return "application/vnd.ms-powerpoint";
            case "odt": return "application/vnd.oasis.opendocument.text";
            case "ods": return "application/vnd.oasis.opendocument.spreadsheet";
            case "html": case "htm": return "text/html; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "js": return "application/javascript";
            case "ts": return "application/typescript";
            case "json": return "application/json";
            case "xml": return "application/xml";
            case "csv": return "text/csv; charset=utf-8";
            case "txt": return "text/plain; charset=utf-8";
            case "md": return "text/markdown; charset=utf-8";
            case "yaml": case "yml": return "text/yaml; charset=utf-8";
            case "sh": case "bash": return "text/x-sh; charset=utf-8";
            case "py": return "text/x-python; charset=utf-8";
            case "java": return "text/x-java; charset=utf-8";
            case "c": return "text/x-csrc; charset=utf-8";
            case "cpp": case "cc": return "text/x-c++src; charset=utf-8";
            case "sql": return "application/sql";
            case "log": return "text/plain; charset=utf-8";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "gif": return "image/gif";
            case "svg": return "image/svg+xml";
            case "webp": return "image/webp";
            case "bmp": return "image/bmp";
            case "ico": return "image/x-icon";
            case "tiff": case "tif": return "image/tiff";
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "ogg": return "audio/ogg";
            case "flac": return "audio/flac";
            case "aac": return "audio/aac";
            case "m4a": return "audio/mp4";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            case "avi": return "video/x-msvideo";
            case "mov": return "video/quicktime";
            case "mkv": return "video/x-matroska";
            case "zip": return "application/zip";
            case "gz": return "application/gzip";
            case "tar": return "application/x-tar";
            case "7z": return "application/x-7z-compressed";
            case "rar": return "application/vnd.rar";
            case "bz2": return "application/x-bzip2";
            case "bin": case "exe": case "dll": return "application/octet-stream";
            default: return "application/octet-stream";
        }
    }
}
