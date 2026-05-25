package org.example.gateway.config;

import org.springframework.stereotype.Component;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * FileRegistry - In memory registry of files
 * Format: fileId|cid|sLevel|pReq|description|status|uploadedBy
 * Files saves after every change and loaded on startup
 * Pre-loaded system files are only created if no data file exists
 */
@Component
public class FileRegistry {
    private static final com.fasterxml.jackson.databind.ObjectMapper OBJECT_MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    public enum FileStatus { APPROVED, PENDING, REJECTED }
    public static class FileEntry {
        private final String fileId;
        private final String cid;
        private int sLevel;
        private double pReq;
        private String description;
        private FileStatus status;
        private final String uploadedBy;
        private final LocalDateTime uploadedAt;
        private int accessCount = 0;
        private String rulesJson = "[]";
        private long fileSize = 0;

        public FileEntry(String fileId, String cid, int sLevel, double pReq,
                         String description, FileStatus status, String uploadedBy) {
            this.fileId = fileId;
            this.cid = cid;
            this.sLevel = sLevel;
            this.pReq = pReq;
            this.description = description;
            this.status = status;
            this.uploadedBy = uploadedBy;
            this.uploadedAt = LocalDateTime.now();
        }

        public String getFileId() { return fileId; }
        public String getCid() { return cid; }
        public int getSLevel() { return sLevel; }
        public double getPReq() { return pReq; }
        public String getDescription() { return description; }
        public FileStatus getStatus() { return status; }
        public String getUploadedBy() { return uploadedBy; }
        public LocalDateTime getUploadedAt() { return uploadedAt; }
        public int getAccessCount() { return accessCount; }
        public void incrementAccessCount() { this.accessCount++; }
        public String getRulesJson() { return rulesJson; }
        public void setRulesJson(String r) { this.rulesJson = r; }
        public long getFileSize() { return fileSize; }
        public void setFileSize(long s) { this.fileSize = s; }
        public String getUploadedAtStr() { return uploadedAt != null ? uploadedAt.toString() : ""; }

        public void setStatus(FileStatus s) { this.status = s; }
        public void setSLevel(int s) { this.sLevel = s; }
        public void setPReq(double p) { this.pReq = p; }
        public void setDescription(String d) { this.description = d; }
        public void setAccessCount(int c) { this.accessCount = c; }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("fileId", fileId);
            m.put("cid", cid);
            m.put("sLevel", sLevel);
            m.put("pReq", pReq);
            m.put("description", description);
            m.put("status", status.name());
            m.put("uploadedBy", uploadedBy);
            m.put("uploadedAt", uploadedAt != null ? uploadedAt.toString() : null);
            m.put("accessCount", accessCount);
            m.put("fileSize", fileSize);
            try {
                List<Map<String, Object>> parsed = FileRegistry.OBJECT_MAPPER.readValue(
                        FileRegistry.normalizeRulesJson(rulesJson),
                        new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
                m.put("rules", parsed);
            } catch (Exception e) {
                m.put("rules", new ArrayList<>());
            }
            m.put("rulesRaw", FileRegistry.normalizeRulesJson(rulesJson));
            return m;
        }

        public Map<String, Object> toUserMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("fileId", fileId);
            m.put("sLevel", sLevel);
            m.put("description", description);
            m.put("status", status.name());
            m.put("fileSize", fileSize);
            return m;
        }

        public String toLine() {
            String encodedDesc = FileRegistry.encodeField(description != null ? description : "");
            String encodedRules = FileRegistry.encodeField(FileRegistry.normalizeRulesJson(rulesJson));
            return String.join("|", "v2", fileId, cid,
                    String.valueOf(sLevel), String.valueOf(pReq),
                    encodedDesc, status.name(),
                    uploadedBy != null ? uploadedBy : "system",
                    uploadedAt != null ? uploadedAt.toString() : "",
                    String.valueOf(accessCount), encodedRules, String.valueOf(fileSize));
        }
    }

    private final Map<String, FileEntry> files = new ConcurrentHashMap<>();
    private static final String DATA_DIR = "data";
    private static final String FILES_FILE = "data/files.dat";
    public FileRegistry() {
        try { Files.createDirectories(Paths.get(DATA_DIR)); } catch (Exception ignored) {}
        boolean loaded = loadFromDisk();
        if (!loaded) {
            saveToDisk();
            System.out.println("[FileRegistry] Initialized empty registry");
        } else {
            System.out.println("[FileRegistry] Loaded " + files.size() + " files from disk");
        }
    }

    private void seed(String fileId, String cid, int sLevel, double pReq, String description) {
        files.put(fileId, new FileEntry(fileId, cid, sLevel, pReq, description, FileStatus.APPROVED, "system"));
    }

    // ================================================================
    // PERSISTENCE
    // ================================================================

    public void saveToDisk() {
        try (PrintWriter writer = new PrintWriter(new FileWriter(FILES_FILE))) {
            for (FileEntry f : files.values()) {
                writer.println(f.toLine());
            }
        } catch (IOException e) {
            System.err.println("[FileRegistry] Failed to save: " + e.getMessage());
        }
    }

    private boolean loadFromDisk() {
        Path path = Paths.get(FILES_FILE);
        if (!Files.exists(path)) return false;

        try (BufferedReader reader = Files.newBufferedReader(path)) {
            String line;
            int count = 0;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                try {
                    FileEntry entry;
                    String fileId;
                    String[] parts = line.split("\\|", -1);
                    if (parts.length >= 12 && "v2".equals(parts[0])) {
                        fileId = parts[1];
                        String cid = parts[2];
                        int sLevel = Integer.parseInt(parts[3]);
                        double pReq = Double.parseDouble(parts[4]);
                        String desc = decodeField(parts[5]);
                        FileStatus status = FileStatus.valueOf(parts[6]);
                        String uploadedBy = parts[7];
                        entry = new FileEntry(fileId, cid, sLevel, pReq, desc, status, uploadedBy);

                        try { entry.accessCount = Integer.parseInt(parts[9]); } catch (Exception ignored) {}
                        entry.rulesJson = normalizeRulesJson(decodeField(parts[10]));
                        try { entry.fileSize = Long.parseLong(parts[11]); } catch (Exception ignored) {}
                    } else {
                        // Legacy format fallback:
                        // fileId|cid|sLevel|pReq|description|status|uploadedBy|uploadedAt|accessCount|rulesJson|fileSize
                        String[] legacy = line.split("\\|", 11);
                        if (legacy.length < 7) continue;
                        fileId = legacy[0];
                        String cid = legacy[1];
                        int sLevel = Integer.parseInt(legacy[2]);
                        double pReq = Double.parseDouble(legacy[3]);
                        String desc = legacy[4].replace("\\|", "|");
                        FileStatus status = FileStatus.valueOf(legacy[5]);
                        String uploadedBy = legacy[6];
                        entry = new FileEntry(fileId, cid, sLevel, pReq, desc, status, uploadedBy);

                        if (legacy.length >= 11) {
                            try { entry.accessCount = Integer.parseInt(legacy[8]); } catch (Exception ignored) {}
                            entry.rulesJson = normalizeRulesJson(legacy[9] != null ? legacy[9].replace("\\|", "|") : "[]");
                            try { entry.fileSize = Long.parseLong(legacy[10]); } catch (Exception ignored) {}
                        }
                    }

                    files.put(fileId, entry);
                    count++;
                } catch (Exception ex) {
                    System.err.println("[FileRegistry] Skipping malformed registry line: " + ex.getMessage());
                }
            }
            return count > 0;
        } catch (Exception e) {
            System.err.println("[FileRegistry] Failed to load: " + e.getMessage());
            return false;
        }
    }

    private static String normalizeRulesJson(String rules) {
        if (rules == null || rules.trim().isEmpty()) return "[]";
        return rules;
    }

    private static String encodeField(String raw) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static String decodeField(String encoded) {
        if (encoded == null || encoded.isEmpty()) return "";
        try {
            return new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            // Backward compatibility: if it was not Base64, treat as plain text.
            return encoded;
        }
    }

    // ================================================================
    // CRUD OPERATIONS
    // ================================================================

    public FileEntry addPending(String fileId, String cid, double suggestedSLevel, String description, String uploadedBy) {
        if (files.containsKey(fileId)) return null;
        int intLevel = Math.max(1, Math.min(5, (int) Math.round(suggestedSLevel * 5)));
        double pReq = suggestedSLevel; // Use decimal directly as threshold
        FileEntry entry = new FileEntry(fileId, cid, intLevel, pReq, description, FileStatus.PENDING, uploadedBy);
        files.put(fileId, entry);
        saveToDisk();
        System.out.println("[FileRegistry] Pending: " + fileId + " by " + uploadedBy);
        return entry;
    }

    public boolean approve(String fileId, int finalSLevel) {
        FileEntry entry = files.get(fileId);
        if (entry == null || entry.getStatus() != FileStatus.PENDING) return false;
        entry.setStatus(FileStatus.APPROVED);
        entry.setSLevel(finalSLevel);
        entry.setPReq(defaultPReq(finalSLevel));
        saveToDisk();
        System.out.println("[FileRegistry] APPROVED: " + fileId + " -> S_level=" + finalSLevel);
        return true;
    }

    public boolean reject(String fileId) {
        FileEntry entry = files.get(fileId);
        if (entry == null || entry.getStatus() != FileStatus.PENDING) return false;
        entry.setStatus(FileStatus.REJECTED);
        saveToDisk();
        System.out.println("[FileRegistry] REJECTED: " + fileId);
        return true;
    }


    public boolean delete(String fileId) {
        FileEntry removed = files.remove(fileId);
        if (removed == null) return false;
        saveToDisk();
        System.out.println("[FileRegistry] DELETED: " + fileId);
        return true;
    }

    // ================================================================
    // QUERIES
    // ================================================================

    public FileEntry get(String fileId) {
        FileEntry entry = files.get(fileId);
        if (entry != null && entry.getStatus() == FileStatus.APPROVED) return entry;
        return null;
    }

    // All approved files (user)
    public Map<String, FileEntry> getAll() {
        return files.entrySet().stream().filter(e -> e.getValue().getStatus() == FileStatus.APPROVED)
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue, (a, b) -> a, LinkedHashMap::new));
    }

    // All files (admin)
    public Collection<FileEntry> getAllAdmin() {
        return files.values();
    }

    // Files uploaded by a specific user
    public List<FileEntry> getByUser(String username) {
        return files.values().stream().filter(f -> username.equals(f.getUploadedBy())).collect(Collectors.toList());
    }

    public int getPendingCount() {
        return (int) files.values().stream().filter(f -> f.getStatus() == FileStatus.PENDING).count();
    }

    private double defaultPReq(int sLevel) {
        switch (sLevel) {
            case 1: return 0.1;
            case 2: return 0.3;
            case 3: return 0.5;
            case 4: return 0.7;
            case 5: return 0.9;
            default: return 0.5;
        }
    }
}
