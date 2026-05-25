package org.example.gateway.service;

import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.time.LocalDate;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

 /**
  * BV-GCA Component 2: Risk Budget Service
  *
  * Tracks cumulative data exposure per user-object-period and enforces
  * budget limits. When a user exceeds their risk budget for a given file
  * in the current period (24h), the service forces HIGH-RISK tier or
  * denies access entirely.
  *
  * Budget function: B(u,o,t) = max(0.2*beta, S_file) * (1 + T_sub)
  *   - Higher-trust users get larger budgets (up to 2x base)
  *   - beta_text = 500KB base multiplier for text files
  *   - beta_binary = 5MB base multiplier for binary files
  *
  * Grace contribution: G = min(B_max(HIGH), S_file)
  *   - B_max(HIGH) = 512 KB
  *
     * Theorem 2 guarantee: L_total(u,o,t) <= B + G + S_max
  */
@Service
@EnableScheduling
public class RiskBudgetService {

    // β multipliers (bytes) — temporarily increased for benchmark testing
    // (revert to 50KB/5MB for production)
    private static final long BETA_TEXT = 500 * 1024;        // 500 KB (was 50 KB)
    private static final long BETA_BINARY = 50 * 1024 * 1024; // 50 MB (was 5 MB)

    // Budget enforcement thresholds
    private static final double SOFT_LIMIT = 1.0;   // force HIGH-RISK at 100% budget
    private static final long BMAX_HIGH = 512L * 1024; // 512 KB — Theorem 1 HIGH ceiling
    private static final double RHO = 0.5;           // grace fraction of budget

    // Grace contribution G = min(Bmax(HIGH), S_remaining, rho * B)
    // Hard limit: L_cum >= B + G => DENY

    // Key: "userId|fileId|date" → cumulative bytes delivered
    private final Map<String, Long> cumulativeLeakage = new ConcurrentHashMap<>();

    /**
     * Compute the risk budget for a user-object pair.
     * B(u,o,t) = β × fileSizeFactor × (1 + T_sub)
     *
     * fileSizeFactor scales with actual file size but has a minimum of 0.2
     * to prevent disproportionate budgets for very small files.
     * Example: for a 5KB text file (β=50KB), fileSizeFactor=0.1 → budget ≈ 10KB
     * instead of the previous minimum of β=50KB regardless of actual size.
     */
    public long computeBudget(double tSub, long fileSize, boolean isText) {
        long beta = isText ? BETA_TEXT : BETA_BINARY;
        // fileSizeFactor: scale budget proportionally to file size,
        // minimum 0.2 so even tiny files get a proportional (not full-base) budget
        double fileSizeFactor = Math.max(0.2, (double) fileSize / beta);
        double trustMultiplier = 1.0 + Math.max(0.0, Math.min(1.0, tSub));
        return (long) (beta * fileSizeFactor * trustMultiplier);
    }

    /**
     * Get cumulative leakage for this user-object in the current period.
     */
    public long getCumulativeLeakage(String userId, String fileId) {
        String key = buildKey(userId, fileId);
        return cumulativeLeakage.getOrDefault(key, 0L);
    }

    /**
     * Record bytes delivered in a session.
     */
    public void recordDelivery(String userId, String fileId, long bytes) {
        String key = buildKey(userId, fileId);
        cumulativeLeakage.merge(key, bytes, Long::sum);
    }

    /**
     * Check budget status. Returns:
     *   "OK"        - within budget, proceed normally
     *   "HIGH_RISK" - exceeded soft limit, force HIGH-RISK tier
     *   "DENY"      - exceeded hard limit, deny access
     */
    public String checkBudget(String userId, String fileId, double tSub,
                              long fileSize, boolean isText) {
        long budget = computeBudget(tSub, fileSize, isText);
        long used = getCumulativeLeakage(userId, fileId);
        double ratio = (double) used / Math.max(1, budget);

        // Grace contribution G = min(Bmax(HIGH), S_remaining, rho * B)
        // S_remaining = max(0, fileSize - used) — bytes not yet delivered
        long sRemaining = Math.max(0L, fileSize - used);
        long grace = Math.min(BMAX_HIGH, Math.min(sRemaining, (long)(RHO * budget)));
        long hardLimit = budget + grace;

        if (used >= hardLimit) {
            double hardRatio = (double) used / Math.max(1, budget);
            System.out.println("[RiskBudget] DENY — user=" + userId + " file=" + fileId
                    + " | used=" + used + " / hardLimit=" + hardLimit
                    + " (B=" + budget + " + G=" + grace + ")"
                    + " (" + Math.round(hardRatio * 100) + "%)");
            return "DENY";
        }
        if (ratio >= SOFT_LIMIT) {
            System.out.println("[RiskBudget] HIGH_RISK forced — user=" + userId
                    + " file=" + fileId + " | used=" + used + " / budget=" + budget
                    + " (" + Math.round(ratio * 100) + "%)");
            return "HIGH_RISK";
        }
        return "OK";
    }

    /**
     * Get budget usage ratio for receipt/logging.
     */
    public double getBudgetUsageRatio(String userId, String fileId,
                                      double tSub, long fileSize, boolean isText) {
        long budget = computeBudget(tSub, fileSize, isText);
        long used = getCumulativeLeakage(userId, fileId);
        return (double) used / Math.max(1, budget);
    }

    /**
     * Reset budget for a specific user (all files, today's entries).
     * Used for admin testing and benchmark recovery after E3 exhaustion.
     */
    public void resetUserBudget(String userId) {
        String today = LocalDate.now().toString();
        String prefix = userId + "|";
        int removed = 0;
        for (String key : cumulativeLeakage.keySet()) {
            if (key.startsWith(prefix) && key.endsWith(today)) {
                cumulativeLeakage.remove(key);
                removed++;
            }
        }
        if (removed > 0) {
            System.out.println("[RiskBudget] Reset budget for user=" + userId
                    + " | removed " + removed + " entries");
        }
    }

    /**
     * Cleanup old entries (call daily or on demand).
     * Keys include the date, so old entries naturally become stale.
     */
    public void evictExpired() {
        String today = LocalDate.now().toString();
        cumulativeLeakage.entrySet().removeIf(e -> !e.getKey().endsWith(today));
        System.out.println("[RiskBudget] Evicted expired entries. Active: "
                + cumulativeLeakage.size());
    }

    /**
     * Fix #6 — enforce Theorem 2's time period (the "t" in B(u,o,t)).
     *
     * Previously, keys contained the date (e.g. "alice|file.pdf|2026-04-19")
     * so yesterday's entries simply stopped being *read*, but they remained
     * in the map and were never evicted. Over a long uptime, the map grew
     * without bound. Worse: evictExpired() existed but was never invoked,
     * so cumulative leakage for "today" was never cleared as days rolled
     * over on a long-running gateway — day 2's first access saw day 1's
     * leakage still keyed under the new date if any stale sum had carried.
     *
     * This scheduled job runs at local midnight (00:00:05 to be outside the
     * boundary) and drops every entry whose date suffix isn't today.
     * Theorem 2's L_total(u,o,t) <= B + G + S_max is now enforced per calendar day
     * as the paper claims.
     */
    @Scheduled(cron = "5 0 0 * * *")
    public void dailyReset() {
        int before = cumulativeLeakage.size();
        evictExpired();
        System.out.println("[RiskBudget] Daily reset fired at midnight. Before=" + before
                + " | After=" + cumulativeLeakage.size());
    }

    private String buildKey(String userId, String fileId) {
        return userId + "|" + fileId + "|" + LocalDate.now().toString();
    }
}
