package org.example.gateway.service;

import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;

/**
 * AnomalyDetector - Behavioral anomaly detection
 *
 * Monitors user behavior for suspicious patterns that Algorithm 2's
 * standard revocation check wouldn't catch:
 * 1. Rapid trust acceleration: T_sub increases unusually fast
 * 2. Access burst detection: sudden spike in access requests
 * 3. File sensitivity escalation: user suddenly starts accessing higher-sensitivity files than their history
 * 4. Time anomaly: access at unusual hours compared to user's pattern
 *
 * It flags anomalies for admin review and can automatically increase B_freq (behavioral penalty) to
 * reduce the user's DT_score via the existing algorithm
 */
@Service
public class AnomalyDetector {


    private final Map<String, UserBehaviorProfile> profiles = new ConcurrentHashMap<>();
    private final List<AnomalyAlert> alerts = Collections.synchronizedList(new ArrayList<>());
    private final Map<String, Long> downloadBlocks = new ConcurrentHashMap<>();
    private final Path anomalyLogPath;

    // Fix #3: log rotation. Append-only logs grow without bound. Rotate the
    // active file to anomaly.log.1 when it crosses LOG_ROTATE_BYTES and keep
    // only the most recent rotated copy. Simple one-generation rotation
    // (no gzip, no multiple backlog files) — enough to keep disk use bounded
    // for a thesis / single-host deployment.
    private static final long LOG_ROTATE_BYTES = 5L * 1024 * 1024; // 5 MB

    public AnomalyDetector() {
        String dir = System.getenv().getOrDefault("CAAC_DATA_DIR", "data");
        anomalyLogPath = Paths.get(dir, "anomaly.log");
        try {
            Files.createDirectories(anomalyLogPath.getParent());
            if (!Files.exists(anomalyLogPath)) {
                Files.writeString(anomalyLogPath, "# CAAC Anomaly Detection Log\n");
            }
        } catch (IOException e) {
            System.err.println("[AnomalyDetector] Could not create log file: " + e.getMessage());
        }
    }

    private synchronized void rotateIfNeeded() {
        try {
            if (!Files.exists(anomalyLogPath)) return;
            long size = Files.size(anomalyLogPath);
            if (size < LOG_ROTATE_BYTES) return;
            Path rotated = anomalyLogPath.resolveSibling("anomaly.log.1");
            Files.move(anomalyLogPath, rotated, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            Files.writeString(anomalyLogPath,
                    "# CAAC Anomaly Detection Log (rotated at " + LocalDateTime.now() + ")\n");
            System.out.println("[AnomalyDetector] Log rotated at " + size + " bytes \u2192 anomaly.log.1");
        } catch (IOException e) {
            System.err.println("[AnomalyDetector] Log rotation failed: " + e.getMessage());
        }
    }

    private void appendLog(String line) {
        try {
            rotateIfNeeded();
            String entry = LocalDateTime.now().toString() + "  " + line + "\n";
            Files.writeString(anomalyLogPath, entry, StandardOpenOption.APPEND);
        } catch (IOException e) {
            System.err.println("[AnomalyDetector] Log write failed: " + e.getMessage());
        }
    }

    // Thresholds
    private static final int BURST_WINDOW_SECONDS = 120;
    private static final int BURST_THRESHOLD = 10;       // alert when count > 10 in 2 mins
    private static final double TRUST_JUMP_THRESHOLD = 0.15;
    private static final int MIN_TRUST_SAMPLES_FOR_JUMP = 3;
    private static final Set<String> TRUST_JUMP_EXCLUDED_USERS = Set.of("admin");
    private static final int MAX_ALERTS = 500;
    private static final double BASE_BLOCK_MINUTES = 10.0;
    private static final double MAX_BLOCK_MINUTES = 1440.0;  // cap - 24 hours

    /**
     * Auto-quarantine: any single alert with severity > THRESHOLD locks the
     * user out for QUARANTINE_MS regardless of burst-counter state. Independent
     * of the soft-block path so a single very-high-severity event (e.g. an
     * S5 sensitivity escalation) immediately freezes the account.
     */
    private static final double QUARANTINE_SEVERITY_THRESHOLD = 0.8;
    private static final long QUARANTINE_MS = 60L * 60_000L; // 1 hour

    public static class UserBehaviorProfile {
        public final String username;
        public final List<Long> accessTimestamps = Collections.synchronizedList(new ArrayList<>());
        public final List<Integer> accessedSLevels = Collections.synchronizedList(new ArrayList<>());
        public double lastKnownTSub = 0.5;
        public boolean trustInitialized = false;
        public int burstCount = 0;
        // Fix #4: ambiguity bug — January 2026 and January 2027 both had
        // getMonthValue()==1 and previously compared equal, which suppressed
        // the reset and punished users for year-old offenses. Encode
        // year*100 + month so distinct calendar months always differ.
        public int lastResetMonth = yearMonthKey(LocalDateTime.now()); // for monthly reset
        public UserBehaviorProfile(String username) {
            this.username = username;
        }
    }

    // Fix #4: encode a calendar month as (year * 100 + monthValue).
    // getMonthValue() alone is 1..12 and wraps every year.
    private static int yearMonthKey(LocalDateTime t) {
        return t.getYear() * 100 + t.getMonthValue();
    }

    public static class AnomalyAlert {
        public final String timestamp;
        public final String username;
        public final String type;        // BURST, TRUST_JUMP, SENSITIVITY_ESCALATION
        public final String description;
        public final double severity;    // 0.0 = low, 1.0 = critical
        public boolean reviewed = false;

        public AnomalyAlert(String username, String type, String description, double severity) {
            this.timestamp = LocalDateTime.now().toString();
            this.username = username;
            this.type = type;
            this.description = description;
            this.severity = severity;
        }

        public Map<String, Object> toMap(int index) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("index", index);
            m.put("timestamp", timestamp);
            m.put("username", username);
            m.put("type", type);
            m.put("description", description);
            m.put("severity", severity);
            m.put("reviewed", reviewed);
            return m;
        }

        public Map<String, Object> toMap() {
            return toMap(-1);
        }
    }

    // ================================================================
    // RECORD ACCESS
    // ================================================================

    /**
     * Record an access attempt and check for anomalies.
     * Call this from FileAccessController after every PERMIT decision
     * returns list of new anomaly alerts
     */
    public List<AnomalyAlert> recordAccess(String username, int sLevel, double currentTSub) {
        List<AnomalyAlert> newAlerts = new ArrayList<>();
        UserBehaviorProfile profile = profiles.computeIfAbsent(username.toLowerCase(), UserBehaviorProfile::new);
        long now = System.currentTimeMillis();
        profile.accessTimestamps.add(now);
        profile.accessedSLevels.add(sLevel);

        // Access burst detection
        long windowStart = now - (BURST_WINDOW_SECONDS * 1_000L);
        long recentCount = profile.accessTimestamps.stream().filter(t -> t >= windowStart).count();

        if (recentCount > BURST_THRESHOLD) {
            // Monthly reset feature
            int currentMonth = yearMonthKey(LocalDateTime.now()); // Fix #4: year*100+month
            if (currentMonth != profile.lastResetMonth) {
                profile.burstCount = 0;
                profile.lastResetMonth = currentMonth;
                System.out.println("[AnomalyDetector] Monthly reset: " + username + " burstCount reset to 0");
            }

            // Exponential block: 10 × e^(2x) minutes, capped at 24 hours
            // x = burstCount BEFORE this offense (0 for first offense -> 10 min)
            double blockMinutes = Math.min(MAX_BLOCK_MINUTES, BASE_BLOCK_MINUTES * Math.exp(2.0 * profile.burstCount));
            long blockMs = (long) (blockMinutes * 60_000L);
            AnomalyAlert alert = new AnomalyAlert(username, "BURST", "User made " + recentCount + " access requests in "
                            + BURST_WINDOW_SECONDS + " seconds (threshold: " + BURST_THRESHOLD + ")"
                            + " — offense #" + (profile.burstCount + 1)
                            + ", blocked for " + String.format("%.0f", blockMinutes) + " minutes",
                    Math.min(1.0, recentCount / (double)(BURST_THRESHOLD * 2)));
            newAlerts.add(alert);
            profile.burstCount++;

            // Temporary block for downloads
            downloadBlocks.put(username.toLowerCase(), now + blockMs);
            System.out.println("[AnomalyDetector] BURST BLOCK: " + username
                    + " | offense #" + profile.burstCount
                    + " | blocked for " + String.format("%.0f", blockMinutes) + " min"
                    + " (formula: 10×e^" + (2 * (profile.burstCount - 1)) + ", cap 1440)");
        }

        // Trust jump detection
        if (!profile.trustInitialized) {
            profile.lastKnownTSub = currentTSub;
            profile.trustInitialized = true;
        }
        double trustDelta = currentTSub - profile.lastKnownTSub;
        boolean excludedUser = TRUST_JUMP_EXCLUDED_USERS.contains(username.toLowerCase());
        int trustSampleCount = profile.accessedSLevels.size();
        if (!excludedUser
                && trustSampleCount >= MIN_TRUST_SAMPLES_FOR_JUMP
                && trustDelta > TRUST_JUMP_THRESHOLD
                && profile.lastKnownTSub > 0.0) {
            AnomalyAlert alert = new AnomalyAlert(username, "TRUST_JUMP",
                    "T_sub jumped from " + String.format("%.3f", profile.lastKnownTSub)
                            + " to " + String.format("%.3f", currentTSub)
                            + " (delta=" + String.format("%.3f", trustDelta) + ")", Math.min(1.0, trustDelta / 0.3));
            newAlerts.add(alert);
        }
        profile.lastKnownTSub = currentTSub;

        // Sensitivity escalation
        if (profile.accessedSLevels.size() > 5) {
            List<Integer> recent = profile.accessedSLevels;
            int historySize = Math.min(recent.size() - 1, 10);
            if (historySize > 0) {
                double avgSLevel = recent.subList(Math.max(0, recent.size() - 1 - historySize),
                        recent.size() - 1).stream().mapToInt(Integer::intValue).average().orElse(1.0);
                if (sLevel > avgSLevel + 1.5) {
                    AnomalyAlert alert = new AnomalyAlert(username, "SENSITIVITY_ESCALATION",
                            "Accessed S_level=" + sLevel + " (average history: " + String.format("%.1f", avgSLevel) + ")",
                            Math.min(1.0, (sLevel - avgSLevel) / 3.0));
                    newAlerts.add(alert);
                }
            }
        }

        // Store alerts
        boolean quarantineTriggered = false;
        double maxSeverity = 0.0;
        String quarantineCause = null;
        synchronized (alerts) {
            for (AnomalyAlert alert : newAlerts) {
                alerts.add(alert);
                System.out.println("[AnomalyDetector] ALERT: " + alert.type
                        + " | " + alert.username + " | " + alert.description
                        + " | severity=" + String.format("%.2f", alert.severity));
                appendLog("ALERT  " + alert.type + "  user=" + alert.username
                        + "  severity=" + String.format("%.2f", alert.severity)
                        + "  " + alert.description);
                if (alert.severity > QUARANTINE_SEVERITY_THRESHOLD && alert.severity > maxSeverity) {
                    quarantineTriggered = true;
                    maxSeverity = alert.severity;
                    quarantineCause = alert.type;
                }
            }

            while (alerts.size() > MAX_ALERTS) {
                alerts.remove(0);
            }
        }

        // Auto-quarantine: any alert with severity > threshold immediately
        // blocks downloads for an hour. Stacks ON TOP of the burst soft-block
        // (we keep whichever expiry is later).
        if (quarantineTriggered) {
            long quarantineExpiry = now + QUARANTINE_MS;
            downloadBlocks.merge(username.toLowerCase(), quarantineExpiry, Math::max);
            System.out.println("[AnomalyDetector] AUTO-QUARANTINE: " + username
                    + " | trigger=" + quarantineCause
                    + " | severity=" + String.format("%.2f", maxSeverity)
                    + " | locked for " + (QUARANTINE_MS / 60_000) + " minutes");
            appendLog("QUARANTINE  user=" + username
                    + "  severity=" + String.format("%.2f", maxSeverity)
                    + "  trigger=" + quarantineCause
                    + "  duration_min=" + (QUARANTINE_MS / 60_000));
        }

        long oneHourAgo = now - 3_600_000L;
        profile.accessTimestamps.removeIf(t -> t < oneHourAgo);

        return newAlerts;
    }

    /**
     * Calculate a B_freq penalty multiplier based on anomalies
     * Returns a value >= 1.0, higher means more anomalous behavior
     */
    public double getBFreqPenalty(String username) {
        UserBehaviorProfile profile = profiles.get(username.toLowerCase());
        if (profile == null) return 1.0;
        // Fix #2: synchronized-list iteration requires holding the list's monitor.
        long recentAlerts;
        synchronized (alerts) {
            recentAlerts = alerts.stream().filter(a -> a.username.equalsIgnoreCase(username))
                    .filter(a -> {
                        try {
                            LocalDateTime alertTime = LocalDateTime.parse(a.timestamp);
                            return ChronoUnit.HOURS.between(alertTime, LocalDateTime.now()) < 1;
                        } catch (Exception e) { return false; }
                    }).count();
        }
        return 1.0 + (recentAlerts * 0.2);
    }

    // ================================================================
    // DOWNLOAD BLOCK
    // ================================================================

    // Checks if a user is temporarily blocked from downloading.
    public long isBlocked(String username) {
        Long expiry = downloadBlocks.get(username.toLowerCase());
        if (expiry == null) return 0;
        long remaining = expiry - System.currentTimeMillis();
        if (remaining <= 0) {
            downloadBlocks.remove(username.toLowerCase());
            return 0;
        }
        return remaining / 1000; // seconds
    }

    // Admin can manually unblock a user
    public void unblock(String username) {
        downloadBlocks.remove(username.toLowerCase());
        System.out.println("[AnomalyDetector] Manual unblock: " + username);
        appendLog("UNBLOCK  user=" + username);
    }

    // ================================================================
    // QUERIES (admin)
    // ================================================================

    public List<AnomalyAlert> getUnreviewedAlerts() {
        List<AnomalyAlert> result = new ArrayList<>();
        // Fix #2: synchronized-list iteration must hold the list's monitor.
        synchronized (alerts) {
            for (int i = alerts.size() - 1; i >= 0; i--) {
                if (!alerts.get(i).reviewed) result.add(alerts.get(i));
            }
        }
        return result;
    }

    public List<Map<String, Object>> getAllAlertsWithIndex() {
        List<Map<String, Object>> result = new ArrayList<>();
        synchronized (alerts) {
            for (int i = alerts.size() - 1; i >= 0; i--) {
                result.add(alerts.get(i).toMap(i));
            }
        }
        return result;
    }

    public List<Map<String, Object>> getUnreviewedAlertsWithIndex() {
        List<Map<String, Object>> result = new ArrayList<>();
        synchronized (alerts) {
            for (int i = alerts.size() - 1; i >= 0; i--) {
                if (!alerts.get(i).reviewed) result.add(alerts.get(i).toMap(i));
            }
        }
        return result;
    }

    public List<AnomalyAlert> getAllAlerts() {
        List<AnomalyAlert> copy = new ArrayList<>();
        synchronized (alerts) {
            for (int i = alerts.size() - 1; i >= 0; i--) {
                copy.add(alerts.get(i));
            }
        }
        return copy;
    }

    public List<AnomalyAlert> getAlertsByUser(String username) {
        List<AnomalyAlert> result = new ArrayList<>();
        synchronized (alerts) {
            for (int i = alerts.size() - 1; i >= 0; i--) {
                if (alerts.get(i).username.equalsIgnoreCase(username)) result.add(alerts.get(i));
            }
        }
        return result;
    }

    public void markReviewed(int index) {
        synchronized (alerts) {
            if (index >= 0 && index < alerts.size()) {
                AnomalyAlert a = alerts.get(index);
                if (!a.reviewed) {
                    a.reviewed = true;
                    appendLog("REVIEWED  index=" + index + "  user=" + a.username + "  type=" + a.type);
                }
            }
        }
    }

    public int markAllReviewed() {
        int count = 0;
        synchronized (alerts) {
            for (int i = 0; i < alerts.size(); i++) {
                if (!alerts.get(i).reviewed) {
                    alerts.get(i).reviewed = true;
                    count++;
                }
            }
        }
        if (count > 0) appendLog("REVIEW_ALL  count=" + count);
        return count;
    }

    public boolean deleteAlert(int index) {
        AnomalyAlert a;
        synchronized (alerts) {
            if (index < 0 || index >= alerts.size()) return false;
            a = alerts.get(index);
            alerts.remove(index);
        }
        appendLog("DELETED  index=" + index + "  user=" + a.username + "  type=" + a.type);
        return true;
    }

    public int deleteAllAlerts() {
        int count;
        synchronized (alerts) {
            count = alerts.size();
            alerts.clear();
        }
        appendLog("DELETED_ALL  count=" + count);
        return count;
    }

    public Map<String, Object> getStats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        long unreviewedCount;
        Map<String, Long> byType = new LinkedHashMap<>();
        int total;
        synchronized (alerts) {
            total = alerts.size();
            unreviewedCount = alerts.stream().filter(a -> !a.reviewed).count();
            for (AnomalyAlert alert : alerts) {
                byType.merge(alert.type, 1L, Long::sum);
            }
        }
        stats.put("totalAlerts", total);
        stats.put("unreviewed", unreviewedCount);
        stats.put("byType", byType);
        return stats;
    }
}
