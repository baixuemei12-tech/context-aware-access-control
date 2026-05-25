package org.example.gateway.service;

import org.example.gateway.model.OracleResult;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * BV-GCA RevocationScheduler — v2 Trust-Rewarded Throughput Allocation
 *
 * Algorithm 2 with cluster risk propagation (CSRP).
 *
 * v2 changes from v1:
 * - Budget is computed by FileAccessController via the unified formula:
 *   L(m, S, T_sub, n) = min(B_max(m), mu(m) * (1 + kappa*T_sub) * S^theta(m) * (1 + psi(m)*n))
 * - No separate speedBonusBytes or dtMultiplier — the formula handles acceleration via psi
 * - No Δt stretching — polling stays at base tier intervals (2s/3s/4s)
 * - Tier shift now properly resets acceleration (Bug 1 fix from code review)
 * - CSRP escalated flag is cleared after reset consumption (Bug 2 fix)
 * - Every constant in the budget formula is derived from a stated policy requirement
 */
@Service
@EnableScheduling
public class RevocationScheduler {

    private final SessionManager sessionManager;
    private final OracleClient oracleClient;

    private final Map<String, Long> lastPollMillis = new ConcurrentHashMap<>();
    private static final long BASE_TICK_MS = 1000L;
    private static final long DT_HIGH_MS   = 2000L;
    private static final long DT_MEDIUM_MS = 3000L;
    private static final long DT_LOW_MS    = 4000L;

    private static final double DELTA_DT_RESET_THRESHOLD = 0.05;

    // CSRP cluster risk state — list of revocation timestamps per subnet
    // Theorem 2a: R_N(t) = Σ exp(-λ_c · (t - t_revoke_i)), clamped at 1.0
    private final Map<String, List<Long>> clusterRevocationTimes = new ConcurrentHashMap<>();
    private static final double LAMBDA_C = 0.1;
    private static final double ETA_N = 0.2;
    private static final double RISK_DECAY_THRESHOLD = 0.01;

    /**
     * Cluster-risk auto-block state.
     * If a subnet's R_N stays above SUBNET_BLOCK_RISK for SUBNET_BLOCK_SUSTAIN_MS,
     * the subnet is hard-blocked from all new sessions for SUBNET_BLOCK_DURATION_MS.
     */
    private final Map<String, Long> subnetHighRiskSince = new ConcurrentHashMap<>();
    private final Map<String, Long> subnetBlockUntil = new ConcurrentHashMap<>();
    private static final double SUBNET_BLOCK_RISK = 0.7;
    private static final long SUBNET_BLOCK_SUSTAIN_MS = 5L * 60_000L;
    private static final long SUBNET_BLOCK_DURATION_MS = 15L * 60_000L;

    public RevocationScheduler(SessionManager sessionManager, OracleClient oracleClient) {
        this.sessionManager = sessionManager;
        this.oracleClient = oracleClient;
    }

    public double getClusterRisk(String networkFingerprint) {
        List<Long> revokeTimes = clusterRevocationTimes.get(networkFingerprint);
        if (revokeTimes == null || revokeTimes.isEmpty()) return 0.0;
        long now = System.currentTimeMillis();
        double sum = 0.0;
        List<Long> surviving = new ArrayList<>();
        for (Long revokeTime : revokeTimes) {
            double minutesElapsed = (now - revokeTime) / 60000.0;
            double risk = Math.exp(-LAMBDA_C * minutesElapsed);
            if (risk >= RISK_DECAY_THRESHOLD) {
                sum += risk;
                surviving.add(revokeTime);
            }
        }
        if (surviving.size() != revokeTimes.size()) {
            if (surviving.isEmpty()) {
                clusterRevocationTimes.remove(networkFingerprint);
            } else {
                clusterRevocationTimes.put(networkFingerprint, surviving);
            }
        }
        return Math.min(sum, 1.0);
    }

    public double getAdjustedMargin(SessionManager.ActiveSession session) {
        double m = session.riskMargin();
        String fp = session.getNetworkFingerprint();
        if (fp == null || fp.isEmpty()) return m;
        double rN = getClusterRisk(fp);
        if (rN > 0) {
            double adjusted = m - ETA_N * Math.min(rN, 1.0);
            if (adjusted < m) {
                session.setCsrpEscalated(true);
            }
            return adjusted;
        }
        return m;
    }

    public void recordNetworkRevocation(SessionManager.ActiveSession session) {
        String fp = session.getNetworkFingerprint();
        if (fp != null && !fp.isEmpty()) {
            clusterRevocationTimes.compute(fp, (k, existing) -> {
                List<Long> list = (existing != null) ? existing : new ArrayList<>();
                list.add(System.currentTimeMillis());
                return list;
            });
            double rN = getClusterRisk(fp);
            session.setClusterRiskValue(rN);
            System.out.println("[BV-GCA CSRP] Cluster risk updated for network: " + fp
                    + " | R_N=" + round4(rN)
                    + " | revocations=" + clusterRevocationTimes.getOrDefault(fp, List.of()).size());
            for (SessionManager.ActiveSession other : sessionManager.getActiveSessions()) {
                if (other.isActive() && !other.getSessionId().equals(session.getSessionId())
                        && fp.equals(other.getNetworkFingerprint())) {
                    double otherRN = getClusterRisk(fp);
                    other.setClusterRiskValue(otherRN);
                    other.resetAcceleration();
                    System.out.println("[BV-GCA CSRP] Session " + other.getSessionId()
                            + " will be escalated (shared network " + fp
                            + ", R_N=" + round4(otherRN) + ")");
                }
            }
        }
    }

    /**
     * Subnet auto-block check. The gateway calls this before admitting any new
     * session — if the subnet has been hard-blocked due to sustained high cluster
     * risk, the request is refused outright until the block expires.
     */
    public boolean isSubnetBlocked(String networkFingerprint) {
        if (networkFingerprint == null || networkFingerprint.isEmpty()) return false;
        Long expiry = subnetBlockUntil.get(networkFingerprint);
        if (expiry == null) return false;
        if (System.currentTimeMillis() >= expiry) {
            subnetBlockUntil.remove(networkFingerprint);
            subnetHighRiskSince.remove(networkFingerprint);
            return false;
        }
        return true;
    }

    public long getSubnetBlockExpiry(String networkFingerprint) {
        Long expiry = subnetBlockUntil.get(networkFingerprint);
        return expiry != null ? expiry : 0L;
    }

    /**
     * Periodic evaluation of cluster-risk → subnet block.
     * Runs every 30s. For every subnet with active revocation history,
     * compute current R_N and either start or clear the "high-risk since"
     * timer; if the timer crosses SUBNET_BLOCK_SUSTAIN_MS, engage the block.
     */
    @Scheduled(fixedDelay = 30_000L)
    public void evaluateClusterAutoBlock() {
        long now = System.currentTimeMillis();
        for (String fp : clusterRevocationTimes.keySet()) {
            if (subnetBlockUntil.containsKey(fp)) continue; // already blocked
            double rN = getClusterRisk(fp);
            if (rN >= SUBNET_BLOCK_RISK) {
                Long firstSeen = subnetHighRiskSince.putIfAbsent(fp, now);
                long sinceMs = now - (firstSeen != null ? firstSeen : now);
                if (sinceMs >= SUBNET_BLOCK_SUSTAIN_MS) {
                    long until = now + SUBNET_BLOCK_DURATION_MS;
                    subnetBlockUntil.put(fp, until);
                    subnetHighRiskSince.remove(fp);
                    System.out.println("[BV-GCA CSRP] AUTO-BLOCK ENGAGED: subnet=" + fp
                            + " | R_N=" + round4(rN)
                            + " | sustained=" + (sinceMs / 1000) + "s"
                            + " | blocked_until=" + new java.util.Date(until));
                }
            } else {
                subnetHighRiskSince.remove(fp);
            }
        }
        // Sweep stale block entries even if their fp is no longer in revocations.
        subnetBlockUntil.entrySet().removeIf(e -> now >= e.getValue());
    }

    private long dtForMargin(double adjustedMargin) {
        if (adjustedMargin < 0.1) return DT_HIGH_MS;
        if (adjustedMargin < 0.3) return DT_MEDIUM_MS;
        return DT_LOW_MS;
    }

    /**
     * Detect whether the context has changed enough to reset acceleration.
     * v2 reset triggers:
     *   1. Tier shift (Bug 1 fix — was missing in v1)
     *   2. DT_score delta > threshold
     *   3. CSRP escalation (flag cleared after consumption — Bug 2 fix)
     */
    private boolean shouldResetAcceleration(SessionManager.ActiveSession session, double currentDtScore, String currentTier) {
        double lastDt = session.getLastAlgo2DtScore();
        if (lastDt < 0.0) return false;

        String lastTier = session.getLastRgcaTier();
        if (lastTier != null && !lastTier.equals(currentTier)) {
            return true;
        }

        if (Math.abs(currentDtScore - lastDt) > DELTA_DT_RESET_THRESHOLD) {
            return true;
        }

        if (session.isCsrpEscalated()) {
            session.setCsrpEscalated(false);
            return true;
        }

        return false;
    }

    @Scheduled(fixedDelay = BASE_TICK_MS)
    public void continuousRevocationCheck() {
        Collection<SessionManager.ActiveSession> activeSessions = sessionManager.getActiveSessions();
        if (activeSessions.isEmpty()) {
            lastPollMillis.clear();
            return;
        }

        long now = System.currentTimeMillis();

        for (SessionManager.ActiveSession session : activeSessions) {
            if (!session.isActive()) continue;
            String sessionId = session.getSessionId();

            double adjustedMargin = getAdjustedMargin(session);
            String currentTier = adjustedMargin >= 0.3 ? "LOW-RISK"
                              : adjustedMargin >= 0.1 ? "MEDIUM-RISK"
                              : "HIGH-RISK";

            long baseDt = dtForMargin(adjustedMargin);

            long lastPoll = lastPollMillis.getOrDefault(sessionId, 0L);
            if (now - lastPoll < baseDt) {
                continue;
            }
            lastPollMillis.put(sessionId, now);

            double clusterRisk = session.getNetworkFingerprint() != null ?
                    getClusterRisk(session.getNetworkFingerprint()) : 0.0;

            OracleResult result = oracleClient.evaluate(session.getContext());
            session.setScores(result.getDtScore(), result.getCeScore());
            session.recordSchedulerCheck();

            boolean shouldRevoke = result.isDeny();

            if (!shouldRevoke && adjustedMargin < 0) {
                shouldRevoke = true;
                System.out.println("[BV-GCA CSRP] Session " + sessionId
                        + " REVOKED: m'=" + round4(adjustedMargin) + " < 0 (cluster risk R_N="
                        + round4(clusterRisk) + " pushed margin below threshold)");
            }

            if (shouldRevoke) {
                session.revoke();
                session.resetAcceleration();
                if (clusterRisk > 0) {
                    session.setClusterRiskValue(clusterRisk);
                }
                lastPollMillis.remove(sessionId);

                String fp = session.getNetworkFingerprint();
                if (fp != null && !fp.isEmpty()) {
                    recordNetworkRevocation(session);
                }

                System.out.println("[BV-GCA] *** REVOCATION ***");
                System.out.println("[BV-GCA] Session  : " + sessionId);
                System.out.println("[BV-GCA] File     : " + session.getFileId());
                System.out.println("[BV-GCA] DT_score : " + result.getDtScore());
                System.out.println("[BV-GCA] Bytes    : " + session.getBytesDelivered());
            } else {
                double currentDtScore = result.getDtScore();
                boolean contextChanged = shouldResetAcceleration(session, currentDtScore, currentTier);

                if (contextChanged) {
                    if (session.isAccelerationActive()) {
                        System.out.println("[BV-GCA Accel] Session " + sessionId
                                + " — context changed (ΔDT=" + round4(Math.abs(currentDtScore - session.getLastAlgo2DtScore()))
                                + ", tier: " + session.getLastRgcaTier() + "→" + currentTier
                                + "), acceleration RESET");
                    }
                    session.resetAcceleration();
                } else {
                    session.incrementStableCheck();

                    if (session.getStableCheckCount() > 0 && !session.isAccelerationActive()) {
                        session.setAccelerationActive(true);
                        System.out.println("[BV-GCA Accel] Session " + sessionId
                                + " — acceleration ENGAGED (tier=" + currentTier
                                + ", stable checks=" + session.getStableCheckCount() + ")");
                    }

                    if (session.isAccelerationActive() && session.getStableCheckCount() % 5 == 0) {
                        System.out.println("[BV-GCA Accel] Session " + sessionId
                                + " | tier=" + currentTier
                                + " | stable=" + session.getStableCheckCount()
                                + " | budget will include ψ·n bonus at next window");
                    }
                }

                session.setLastAlgo2DtScore(currentDtScore);
                session.setLastRgcaTier(currentTier);
                session.setRgcaTier(currentTier);

                System.out.println("[BV-GCA Algo2] ALLOW — Session " + sessionId
                        + " | tier=" + currentTier + " | Δt=" + (baseDt / 1000) + "s"
                        + " | m'=" + round4(adjustedMargin) + " | DT=" + round4(currentDtScore)
                        + " | n=" + session.getStableCheckCount());
            }
        }
    }

    private double round4(double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }
}
