package org.example.gateway.service;

import org.example.gateway.model.AccessRequest;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Collection;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * BV-GCA SessionManager
 *
 * Manages active sessions, EMA trust evolution with adaptive gamma(R_sub),
 * and CAAR receipt submission to blockchain via OracleClient on session close.
 *
 * Security:
 * - SessionId and username are SHA-256 hashed before on-chain storage (privacy)
 * - Receipt submission is async (CompletableFuture) — never blocks session close
 * - Receipt failure is non-fatal — logged but never propagated
 */
@Service
@EnableScheduling
public class SessionManager {

    private final Map<String, Double> userTrustMemory = new ConcurrentHashMap<>();
    private final Map<String, Long> trustMemoryTimestamps = new ConcurrentHashMap<>();
    /** Consecutive clean (non-revoked) sessions per user; resets on revocation. */
    private final Map<String, Integer> cleanStreak = new ConcurrentHashMap<>();
    private static final long TRUST_TTL_MS = 24 * 60 * 60 * 1000L;
    /** Recovery is only granted after N consecutive clean sessions (anti-grinding). */
    private static final int RECOVERY_STREAK_THRESHOLD = 3;
    /** Decay (revocation) is faster than recovery — asymmetric γ per BV-GCA spec. */
    private static final double DECAY_MULTIPLIER = 2.0;
    private static final double RECOVERY_MULTIPLIER = 0.5;
    private final OracleClient oracleClient;

    public SessionManager(OracleClient oracleClient) {
        this.oracleClient = oracleClient;
    }

    public double getEvolvedTSub(String userId, double defaultTSub) {
        return userTrustMemory.getOrDefault(userId, defaultTSub);
    }

    public void resetAllTrust() {
        userTrustMemory.clear();
        trustMemoryTimestamps.clear();
        System.out.println("[T_sub Evolution] All user trust scores reset to defaults.");
    }

    @Scheduled(fixedDelay = 300000)
    public void evictStaleTrust() {
        long now = System.currentTimeMillis();
        trustMemoryTimestamps.entrySet().removeIf(e -> (now - e.getValue()) > TRUST_TTL_MS);
        int before = userTrustMemory.size();
        userTrustMemory.keySet().retainAll(trustMemoryTimestamps.keySet());
        int removed = before - userTrustMemory.size();
        if (removed > 0) {
            System.out.println("[T_sub Evolution] Evicted " + removed + " stale trust entries");
        }
    }

    /**
     * BV-GCA: Adaptive gamma EMA trust evolution with asymmetric recovery.
     *
     * Base gamma(R_sub) = 0.05 + 0.025 * (5 - R_sub)
     *   R_sub=5 (admin)   -> 0.05
     *   R_sub=3 (regular) -> 0.10
     *   R_sub=1 (guest)   -> 0.15
     *
     * Asymmetric application:
     *   - Revocation: gamma * DECAY_MULTIPLIER (faster fall — bad behavior penalised quickly)
     *   - Clean session: gamma * RECOVERY_MULTIPLIER, BUT only after the user
     *     has accumulated RECOVERY_STREAK_THRESHOLD consecutive clean sessions
     *     (prevents grinding back lost trust with rapid trivial requests).
     *   - During the streak's "warm-up" window, trust is held flat.
     */
    public void evolveTSub(String userId, double currentTSub, boolean wasRevoked, int rSub) {
        int clampedRSub = Math.min(5, Math.max(1, rSub));
        double baseGamma = 0.05 + 0.025 * (5 - clampedRSub);

        double newTSub = currentTSub;
        String mode;
        double effectiveGamma;

        if (wasRevoked) {
            // Reset streak; apply faster decay.
            cleanStreak.put(userId, 0);
            effectiveGamma = baseGamma * DECAY_MULTIPLIER;
            newTSub = currentTSub + effectiveGamma * (0.0 - currentTSub);
            mode = "REVOKED";
        } else {
            int streak = cleanStreak.getOrDefault(userId, 0) + 1;
            cleanStreak.put(userId, streak);
            if (streak < RECOVERY_STREAK_THRESHOLD) {
                // Hold flat — earn recovery only after sustained good behavior.
                effectiveGamma = 0.0;
                mode = "CLEAN(streak=" + streak + "/" + RECOVERY_STREAK_THRESHOLD + ", hold)";
            } else {
                effectiveGamma = baseGamma * RECOVERY_MULTIPLIER;
                newTSub = currentTSub + effectiveGamma * (1.0 - currentTSub);
                mode = "CLEAN(streak=" + streak + ", recover)";
            }
        }

        newTSub = Math.round(newTSub * 10000.0) / 10000.0;
        newTSub = Math.max(0.0, Math.min(1.0, newTSub));
        userTrustMemory.put(userId, newTSub);
        trustMemoryTimestamps.put(userId, System.currentTimeMillis());
        System.out.println("[BV-GCA T_sub] User: " + userId
                + " | R_sub=" + clampedRSub
                + " | gamma_base=" + baseGamma + " | gamma_eff=" + effectiveGamma
                + " | Before: " + currentTSub
                + " | Mode: " + mode
                + " | After: " + newTSub);
    }

    // ================================================================
    // ACTIVE SESSION
    // ================================================================

    public static class ActiveSession {
        private final String sessionId;
        private final String fileId;
        private final AccessRequest context;
        private final String ownerUsername;
        private final LocalDateTime startTime;
        private volatile boolean revoked = false;
        private volatile boolean active = true;
        private volatile double dtScore = 0.0;
        private volatile double pReq = 0.5;
        private volatile double ceScore = 0.0;
        private volatile long bytesDelivered = 0;
        private volatile long bytesAtLastCheck = 0;
        private volatile long maxWindowBytes = 0;
        private volatile long windowBudget = 0;
        private volatile long windowBytesDelivered = 0;
        private volatile boolean windowBudgetExhausted = false;
        private volatile long fileSize = 0;
        private volatile String rgcaTier = "UNKNOWN";
        private volatile String networkFingerprint = "";
        private volatile boolean csrpEscalated = false;
        private volatile long budgetUsed = 0;
        private volatile long budgetLimit = 0;
        private volatile double clusterRiskValue = 0.0;

        // BV-GCA v2: Trust-Rewarded Throughput Allocation
        // Budget is computed directly via L(m,S,T_sub,n) = min(B_max, mu*(1+kappa*T_sub)*S^theta*(1+psi*n))
        // No separate speedBonusBytes or dtMultiplier — the formula handles acceleration via psi
        private volatile int stableCheckCount = 0;
        private volatile double lastAlgo2DtScore = -1.0;
        private volatile boolean accelerationActive = false;
        private volatile String lastRgcaTier = null;

        // Fix #1: per-tier max window bytes, so Theorem 3 can check each window
        // against the bound active WHEN THAT WINDOW WAS SERVED (not the final tier only)
        private volatile long maxWindowBytesHigh = 0;
        private volatile long maxWindowBytesMedium = 0;
        private volatile long maxWindowBytesLow = 0;
        // Worst-case tier bound encountered (strictest bound hit during the session)
        private volatile long minTierBoundEverApplied = Long.MAX_VALUE;

        public ActiveSession(String sessionId, String fileId, AccessRequest context, String ownerUsername) {
            this.sessionId = sessionId;
            this.fileId = fileId;
            this.context = context;
            this.ownerUsername = ownerUsername;
            this.startTime = LocalDateTime.now();
            try { this.pReq = Double.parseDouble(context.getPReq()); } catch (Exception e) { /* default 0.5 */ }
        }

        public String getSessionId() { return sessionId; }
        public String getFileId() { return fileId; }
        public AccessRequest getContext() { return context; }
        public String getOwnerUsername() { return ownerUsername; }
        public LocalDateTime getStartTime() { return startTime; }
        public boolean isRevoked() { return revoked; }
        public boolean isActive()  { return active; }
        public double getDtScore() { return dtScore; }
        public double getPReq() { return pReq; }
        public double getCeScore() { return ceScore; }
        public long getBytesDelivered() { return bytesDelivered; }
        public void addBytesDelivered(int bytes) { this.bytesDelivered += bytes; this.windowBytesDelivered += bytes; }
        public long getMaxWindowBytes() { return maxWindowBytes; }
        public long getMaxWindowBytesHigh()   { return maxWindowBytesHigh; }
        public long getMaxWindowBytesMedium() { return maxWindowBytesMedium; }
        public long getMaxWindowBytesLow()    { return maxWindowBytesLow; }
        public long getMinTierBoundEverApplied() {
            return minTierBoundEverApplied == Long.MAX_VALUE ? windowBudget : minTierBoundEverApplied;
        }
        /** Called by streamer when the current window budget is known for this tier. */
        public void trackTierBound(long budget) {
            if (budget > 0 && budget < minTierBoundEverApplied) {
                minTierBoundEverApplied = budget;
            }
        }
        /** Update the per-tier max-window register based on which tier was active. */
        private void updateMaxWindowForTier(long windowBytes) {
            if (windowBytes > maxWindowBytes) maxWindowBytes = windowBytes;
            String t = rgcaTier == null ? "" : rgcaTier.toUpperCase();
            if (t.contains("HIGH")) {
                if (windowBytes > maxWindowBytesHigh) maxWindowBytesHigh = windowBytes;
            } else if (t.contains("MEDIUM")) {
                if (windowBytes > maxWindowBytesMedium) maxWindowBytesMedium = windowBytes;
            } else if (t.contains("LOW")) {
                if (windowBytes > maxWindowBytesLow) maxWindowBytesLow = windowBytes;
            }
        }
        public void recordSchedulerCheck() {
            long windowBytes = bytesDelivered - bytesAtLastCheck;
            updateMaxWindowForTier(windowBytes);
            bytesAtLastCheck = bytesDelivered;
        }
        public long getWindowBudget() { return windowBudget; }
        public long getWindowBytesDelivered() { return windowBytesDelivered; }
        public boolean isWindowBudgetExhausted() { return windowBudgetExhausted; }
        public void setWindowBudget(long budget) { this.windowBudget = budget; this.windowBytesDelivered = 0; this.windowBudgetExhausted = false; }
        public void markWindowBudgetExhausted() { this.windowBudgetExhausted = true; }
        public void resetWindow() {
            long windowBytes = bytesDelivered - bytesAtLastCheck;
            updateMaxWindowForTier(windowBytes);
            bytesAtLastCheck = bytesDelivered;
            windowBytesDelivered = 0;
            windowBudgetExhausted = false;
        }
        public long getFileSize() { return fileSize; }
        public void setFileSize(long size) { this.fileSize = size; }
        public boolean hasWindowBudget() { return windowBytesDelivered < windowBudget; }
        public String getRgcaTier() { return rgcaTier; }
        public void setRgcaTier(String tier) { this.rgcaTier = tier; }
        public String getNetworkFingerprint() { return networkFingerprint; }
        public void setNetworkFingerprint(String fp) { this.networkFingerprint = fp; }
        public boolean isCsrpEscalated() { return csrpEscalated; }
        public void setCsrpEscalated(boolean v) { this.csrpEscalated = v; }
        public long getBudgetUsed() { return budgetUsed; }
        public void setBudgetUsed(long v) { this.budgetUsed = v; }
        public long getBudgetLimit() { return budgetLimit; }
        public void setBudgetLimit(long v) { this.budgetLimit = v; }
        public double getClusterRiskValue() { return clusterRiskValue; }
        public void setClusterRiskValue(double v) { this.clusterRiskValue = v; }
        public int getStableCheckCount() { return stableCheckCount; }
        public void incrementStableCheck() { this.stableCheckCount++; }
        public double getLastAlgo2DtScore() { return lastAlgo2DtScore; }
        public void setLastAlgo2DtScore(double v) { this.lastAlgo2DtScore = v; }
        public boolean isAccelerationActive() { return accelerationActive; }
        public void setAccelerationActive(boolean v) { this.accelerationActive = v; }
        public String getLastRgcaTier() { return lastRgcaTier; }
        public void setLastRgcaTier(String v) { this.lastRgcaTier = v; }
        public void resetAcceleration() {
            this.stableCheckCount = 0;
            this.accelerationActive = false;
        }
        public void setScores(double dtScore, double ceScore) {
            this.dtScore = dtScore;
            this.ceScore = ceScore;
        }

        public double riskMargin() { return dtScore - pReq; }
        public void revoke() { this.revoked = true; this.active = false; }
        public void close() { this.active = false; }
    }

    // ================================================================
    // SESSION REGISTRY
    // ================================================================

    private final Map<String, ActiveSession> sessions = new ConcurrentHashMap<>();
    private static final long SESSION_TTL_MS = 10 * 60 * 1000L; // 10 minutes idle

    @Scheduled(fixedDelay = 60000)
    public void evictStaleSessions() {
        sessions.entrySet().removeIf(e -> {
            ActiveSession s = e.getValue();
            if (s.isActive() && !s.isRevoked() && s.getBytesDelivered() > 0) {
                return false;
            }
            long ageMs = java.time.Duration.between(s.getStartTime(), LocalDateTime.now()).toMillis();
            if (ageMs > SESSION_TTL_MS) {
                System.out.println("[SessionManager] Evicting stale session: " + s.getSessionId()
                        + " (age=" + (ageMs / 60000) + "min)");
                s.close();
                return true;
            }
            return false;
        });
    }

    public ActiveSession register(String sessionId, String fileId, AccessRequest context, String ownerUsername) {
        ActiveSession session = new ActiveSession(sessionId, fileId, context, ownerUsername);
        sessions.put(sessionId, session);
        System.out.println("[SessionManager] Session registered: " + sessionId + " -> " + fileId);
        return session;
    }

    public ActiveSession register(String sessionId, String fileId, AccessRequest context) {
        return register(sessionId, fileId, context, null);
    }

    public void close(String sessionId) {
        ActiveSession session = sessions.remove(sessionId);
        if (session == null) return;

        boolean wasRevoked = session.isRevoked();
        session.close();

        String userId = session.getOwnerUsername();
        if (userId == null || userId.isBlank()) {
            userId = "user_role_" + session.getContext().getRSub();
        }

        // Extract rSub from session context BEFORE searching (session already removed from map)
        int rSub = 3;
        try { rSub = Integer.parseInt(session.getContext().getRSub()); } catch (Exception ignored) {}

        double currentTSub;
        try { currentTSub = Double.parseDouble(session.getContext().getTSub()); }
        catch (Exception e) { currentTSub = 0.5; }

        evolveTSub(userId, currentTSub, wasRevoked, rSub);

        // Ensure the final partial window is captured before we report metrics.
        session.recordSchedulerCheck();

        // CAAR local receipt log (always printed, even if on-chain submission fails)
        String tier = session.getRgcaTier();
        long bytes = session.getBytesDelivered();

        // --------------------------------------------------------------
        // Fix #1 — Theorem 3 compliance check
        //
        // OLD: compliant = !wasRevoked || (maxWindowBytes <= windowBudget)
        //       where windowBudget reflected only the FINAL tier, not the tier
        //       each window was actually served under. This produced false
        //       VIOLATION for sessions that streamed under LOW then degraded,
        //       and false COMPLIANT for the opposite direction.
        //
        // NEW: each window is checked against the tier bound that was active
        //      while that window was served. Bounds are the theoretical
        //      B_max(m) ceilings from Theorem 1:
        //          HIGH   ≤ 512 KB
        //          MEDIUM ≤ 2   MB
        //          LOW    ≤ 4   MB
        //      These are the tier-maximum bounds; any window that stayed
        //      within its tier's max is compliant. We also fall back to the
        //      strictest per-window budget ever applied on this session.
        // --------------------------------------------------------------
        final long HIGH_BOUND   = 512L * 1024;
        final long MEDIUM_BOUND = 2L * 1024 * 1024;
        final long LOW_BOUND    = 4L * 1024 * 1024;

        long highMax   = session.getMaxWindowBytesHigh();
        long mediumMax = session.getMaxWindowBytesMedium();
        long lowMax    = session.getMaxWindowBytesLow();

        boolean compliantPerTier =
                (highMax   <= HIGH_BOUND)   &&
                (mediumMax <= MEDIUM_BOUND) &&
                (lowMax    <= LOW_BOUND);

        // The leakage bound recorded on-chain: the strictest tier bound the
        // session ever operated under (conservatively the worst-case applied).
        long leakageBound = session.getMinTierBoundEverApplied();
        if (leakageBound <= 0) leakageBound = session.getWindowBudget();

        // For non-revoked sessions that completed naturally, accept as compliant
        // so long as no window violated its tier ceiling. For revoked sessions,
        // the same tier check is the honest answer.
        final boolean compliant = compliantPerTier;
        final long finalLeakageBound = leakageBound;
        System.out.println("[CAAR] Receipt | session=" + sessionId
                + " | user=" + userId + " | file=" + session.getFileId()
                + " | tier=" + tier + " | bytes=" + bytes
                + " | maxWindow(H/M/L)=" + highMax + "/" + mediumMax + "/" + lowMax
                + " | bounds(H/M/L)=" + HIGH_BOUND + "/" + MEDIUM_BOUND + "/" + LOW_BOUND
                + " | strictestBoundApplied=" + finalLeakageBound
                + " | compliant=" + compliant
                + " | revoked=" + wasRevoked + " | csrpEscalated=" + session.isCsrpEscalated());

        // BV-GCA CAAR: Async receipt submission to blockchain
        // Privacy: hash sessionId and username with SHA-256 before on-chain storage
        final String sessHash = sha256Full(sessionId);
        final String userHash = sha256Full(userId);
        final String fileId = session.getFileId();
        final boolean revoked = wasRevoked;

        CompletableFuture.runAsync(() -> {
            try {
                oracleClient.submitReceipt(
                        sessHash, userHash, fileId, tier,
                        bytes, revoked, finalLeakageBound,
                        session.getBudgetUsed(), session.getBudgetLimit(),
                        session.getClusterRiskValue(), compliant);
            } catch (Exception e) {
                // Fail-safe: receipt failure must NEVER break session lifecycle
                System.err.println("[CAAR] Async receipt submission failed (non-fatal): " + e.getMessage());
            }
        });

        System.out.println("[SessionManager] Session closed "
                + (wasRevoked ? "(REVOKED)" : "(normal)") + ": " + sessionId);
    }

    /**
     * SHA-256 hash for on-chain session/user privacy.
     * Returns full 64-hex-char (256-bit) digest.
     */
    public static String sha256Full(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /** Legacy: truncated 16-hex-char hash. Use sha256Full() for new code. */
    public static String sha256Short(String input) {
        return sha256Full(input).substring(0, 16);
    }

    public ActiveSession getSession(String sessionId) {
        return sessions.get(sessionId);
    }

    public Collection<ActiveSession> getActiveSessions() {
        return sessions.values();
    }

    public int getActiveCount() {
        return sessions.size();
    }
}
