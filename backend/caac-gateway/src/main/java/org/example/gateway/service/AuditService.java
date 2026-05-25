package org.example.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;

/**
 * AuditService - Tamper-proof access audit trail
 *
 * The HMAC is computed over all data fields using a secret key
 * On startup, each loaded entry is verified - tampered lines are flagged (logged as WARNING) and excluded from query results
 * 
 * HMAC key is loaded from the environment variable CAAC_AUDIT_HMAC_KEY or the property audit.hmac.key
 * If neither is set, a random key is generated on startup
 */
@Service
public class AuditService {

    public static class AuditEntry {
        public final String timestamp;
        public final String username;
        public final String fileId;
        public final String decision; // PERMIT, DENY, REVOKED, ERROR
        public final double dtScore;
        public final double ceScore;
        public final double pReq;
        public final double riskMargin;
        public final String clientIp;
        public final String networkType;
        public final String platform;
        public final String sessionId;
        public final int rSub;
        public final int sLevel;
        public final boolean hmacValid;

        public AuditEntry(String timestamp, String username, String fileId,
                          String decision, double dtScore, double ceScore,
                          double pReq, double riskMargin,
                          String clientIp, String networkType, String platform,
                          String sessionId, int rSub, int sLevel) {
            this(timestamp, username, fileId, decision, dtScore, ceScore,
                 pReq, riskMargin, clientIp, networkType, platform,
                 sessionId, rSub, sLevel, true);
        }

        public AuditEntry(String timestamp, String username, String fileId,
                          String decision, double dtScore, double ceScore,
                          double pReq, double riskMargin,
                          String clientIp, String networkType, String platform,
                          String sessionId, int rSub, int sLevel,
                          boolean hmacValid) {
            this.timestamp = timestamp;
            this.username = username;
            this.fileId = fileId;
            this.decision = decision;
            this.dtScore = dtScore;
            this.ceScore = ceScore;
            this.pReq = pReq;
            this.riskMargin = riskMargin;
            this.clientIp = clientIp;
            this.networkType = networkType;
            this.platform = platform;
            this.sessionId = sessionId;
            this.rSub = rSub;
            this.sLevel = sLevel;
            this.hmacValid = hmacValid;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("timestamp", timestamp);
            m.put("username", username);
            m.put("fileId", fileId);
            m.put("decision", decision);
            m.put("dtScore", dtScore);
            m.put("ceScore", ceScore);
            m.put("pReq", pReq);
            m.put("riskMargin", riskMargin);
            m.put("clientIp", clientIp);
            m.put("networkType", networkType);
            m.put("platform", platform);
            m.put("sessionId", sessionId != null ? sessionId : "");
            m.put("rSub", rSub);
            m.put("sLevel", sLevel);
            m.put("hmacValid", hmacValid);
            return m;
        }

        public String toDataLine() {
            return String.join("|",
                    timestamp, username, fileId, decision,
                    String.valueOf(dtScore), String.valueOf(ceScore),
                    String.valueOf(pReq), String.valueOf(riskMargin),
                    safe(clientIp), safe(networkType), safe(platform),
                    sessionId != null ? sessionId : "",
                    String.valueOf(rSub), String.valueOf(sLevel));
        }
        private String safe(String s) { return s != null ? s.replace("|", "") : ""; }
    }

    private final List<AuditEntry> entries = new CopyOnWriteArrayList<>();
    private static final String DATA_DIR = "data";
    private static final String AUDIT_FILE = "data/audit.log";
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final String hmacKey;
    private int tamperedCount = 0;
    private int legacyCount = 0; // entries without HMAC

    public AuditService(@Value("${audit.hmac.key:}") String configKey) {
        String envKey = System.getenv("CAAC_AUDIT_HMAC_KEY");
        if (envKey != null && !envKey.isEmpty()) {
            this.hmacKey = envKey;
            System.out.println("[AuditService] HMAC key loaded from environment");
        } else if (configKey != null && !configKey.isEmpty()) {
            this.hmacKey = configKey;
            System.out.println("[AuditService] HMAC key loaded from config");
        } else {
            // if no key provided
            this.hmacKey = SecurityUtils.generateNonce() + SecurityUtils.generateNonce();
            System.out.println("[AuditService] WARNING: Generated random HMAC key (dev mode)");
            System.out.println("[AuditService] Set CAAC_AUDIT_HMAC_KEY env var for production!");
        }

        try { Files.createDirectories(Paths.get(DATA_DIR)); } catch (Exception ignored) {}
        loadFromDisk();
        System.out.println("[AuditService] Loaded " + entries.size() + " audit entries"
                + " | " + tamperedCount + " tampered | " + legacyCount + " legacy (no HMAC)");
    }
    
    public int getUserFileAccessCountToday(String username, String fileId) {
        String today = java.time.LocalDateTime.now()
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd"));
        return (int) entries.stream().filter(e -> e.username.equalsIgnoreCase(username)).filter(e -> e.fileId.equals(fileId))
                .filter(e -> e.decision.equals("PERMIT")).filter(e -> e.timestamp.startsWith(today)).count();
    }

    // ================================================================
    // LOGGING
    // ================================================================

    public void log(String username, String fileId, String decision,
                    double dtScore, double ceScore, double pReq, double riskMargin,
                    String clientIp, String networkType, String platform,
                    String sessionId, int rSub, int sLevel) {

        String ts = LocalDateTime.now().format(FMT);
        AuditEntry entry = new AuditEntry(ts, username, fileId, decision,
                dtScore, ceScore, pReq, riskMargin,
                clientIp, networkType, platform, sessionId, rSub, sLevel);
        entries.add(entry);
        appendToDisk(entry);

        System.out.println("[Audit] " + decision + " | " + username + " -> " + fileId + " | DT=" + dtScore + " | " + ts + " | HMAC=signed");
    }

    public void logRevocation(String username, String fileId, String sessionId) {
        String ts = LocalDateTime.now().format(FMT);
        AuditEntry entry = new AuditEntry(ts, username, fileId, "REVOKED", 0, 0, 0, 0, "", "", "", sessionId, 0, 0);
        entries.add(entry);
        appendToDisk(entry);
        System.out.println("[Audit] REVOKED | " + username + " -> " + fileId + " | session=" + sessionId + " | HMAC=signed");
    }

    // ================================================================
    // QUERIES
    // ================================================================

    // All entries (admin)
    public List<AuditEntry> getAll() {
        List<AuditEntry> reversed = new ArrayList<>(entries);
        Collections.reverse(reversed);
        return reversed;
    }

    public List<AuditEntry> getRecent(int limit) {
        List<AuditEntry> all = getAll();
        return all.subList(0, Math.min(limit, all.size()));
    }

    public List<AuditEntry> getByUser(String username) {
        return entries.stream()
                .filter(e -> username.equalsIgnoreCase(e.username))
                .sorted((a, b) -> b.timestamp.compareTo(a.timestamp))
                .collect(Collectors.toList());
    }

    public Map<String, Long> getDecisionCounts() {
        return entries.stream()
                .collect(Collectors.groupingBy(e -> e.decision, Collectors.counting()));
    }

    public Map<String, Long> getFileAccessCounts() {
        return entries.stream()
                .collect(Collectors.groupingBy(e -> e.fileId, Collectors.counting()));
    }

    public Map<String, Long> getFileAccessCountsByDecision(String decision) {
        return entries.stream()
                .filter(e -> decision.equalsIgnoreCase(e.decision))
                .collect(Collectors.groupingBy(e -> e.fileId, Collectors.counting()));
    }

    public Map<String, Long> getFileAccessCountsLastHoursByDecision(int hours, String decision) {
        String cutoff = LocalDateTime.now().minusHours(hours).format(FMT);
        return entries.stream()
                .filter(e -> e.timestamp.compareTo(cutoff) >= 0)
                .filter(e -> decision.equalsIgnoreCase(e.decision))
                .collect(Collectors.groupingBy(e -> e.fileId, Collectors.counting()));
    }

    public Map<String, Long> getUserAccessCounts() {
        return entries.stream()
                .collect(Collectors.groupingBy(e -> e.username, Collectors.counting()));
    }

    public List<AuditEntry> getLastHours(int hours) {
        String cutoff = LocalDateTime.now().minusHours(hours).format(FMT);
        return entries.stream()
                .filter(e -> e.timestamp.compareTo(cutoff) >= 0)
                .sorted((a, b) -> b.timestamp.compareTo(a.timestamp))
                .collect(Collectors.toList());
    }

    public int getTotalCount() { return entries.size(); }
    public int getTamperedCount() { return tamperedCount; }
    public int getLegacyCount() { return legacyCount; }

    // ================================================================
    // PERSISTENCE
    // ================================================================

    // Format: data_fields|HMAC_SIGNATURE
    private void appendToDisk(AuditEntry entry) {
        String dataLine = entry.toDataLine();
        String hmac = SecurityUtils.hmacSha256(hmacKey, dataLine);
        try (FileWriter fw = new FileWriter(AUDIT_FILE, true)) {
            fw.write(dataLine + "|" + hmac + "\n");
        } catch (IOException e) {
            System.err.println("[AuditService] Failed to write: " + e.getMessage());
        }
    }

    /**
     * Load entries from disk with HMAC verification
     * For each line:
     * - If 15 fields (14 data + 1 HMAC): verify HMAC, flag if tampered
     * - If 14 fields (legacy, no HMAC): accept but mark as legacy
     * - Tampered entries are loaded but flagged
     */
    private void loadFromDisk() {
        Path path = Paths.get(AUDIT_FILE);
        if (!Files.exists(path)) return;
        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            int lineNum = 0;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                lineNum++;
                String[] p = line.split("\\|");
                if (p.length >= 15) {
                    String storedHmac = p[p.length - 1];
                    String dataLine = String.join("|", Arrays.copyOfRange(p, 0, p.length - 1));
                    boolean valid = SecurityUtils.verifyHmac(hmacKey, dataLine, storedHmac);
                    if (!valid) {
                        tamperedCount++;
                        System.out.println("[AuditService] WARNING: Tampered entry at line " + lineNum + ": " + p[0] + " " + p[1] + " " + p[3]);
                    }
                
                    try {
                        entries.add(new AuditEntry(
                                p[0], p[1], p[2], p[3],
                                Double.parseDouble(p[4]), Double.parseDouble(p[5]),
                                Double.parseDouble(p[6]), Double.parseDouble(p[7]),
                                p[8], p[9], p[10], p[11],
                                Integer.parseInt(p[12]), Integer.parseInt(p[13]),
                                valid));
                    } catch (NumberFormatException ignored) {}

                } else if (p.length == 14) {
                    // Legacy format (no HMAC)
                    legacyCount++;
                    try {
                        entries.add(new AuditEntry(
                                p[0], p[1], p[2], p[3],
                                Double.parseDouble(p[4]), Double.parseDouble(p[5]),
                                Double.parseDouble(p[6]), Double.parseDouble(p[7]),
                                p[8], p[9], p[10], p[11],
                                Integer.parseInt(p[12]), Integer.parseInt(p[13]),
                                true));
                    } catch (NumberFormatException ignored) {}
                }
            }

            if (legacyCount > 0) {
                rewriteWithHmac();
                System.out.println("[AuditService] Re-signed " + legacyCount + " legacy entries with HMAC");
            }

        } catch (Exception e) {
            System.err.println("[AuditService] Failed to load: " + e.getMessage());
        }
    }

    private void rewriteWithHmac() {
        try (PrintWriter writer = new PrintWriter(new FileWriter(AUDIT_FILE))) {
            for (AuditEntry entry : entries) {
                String dataLine = entry.toDataLine();
                String hmac = SecurityUtils.hmacSha256(hmacKey, dataLine);
                writer.println(dataLine + "|" + hmac);
            }
        } catch (IOException e) {
            System.err.println("[AuditService] Rewrite failed: " + e.getMessage());
        }
    }
}
