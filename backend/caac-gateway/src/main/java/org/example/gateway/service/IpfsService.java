package org.example.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * IpfsService
 * Files are encrypted before being sent to IPFS
 * 
 * Flow:
 *   Upload: plaintext -> AES-256-GCM encrypt -> upload ciphertext to IPFS -> return CID
 *   Download: fetch ciphertext from IPFS -> AES-256-GCM decrypt -> return plaintext
 */
@Service
public class IpfsService {

    @Value("${ipfs.api.url:http://127.0.0.1:5001}")
    private String ipfsApiUrl;
    @Value("${ipfs.gateway.url:http://127.0.0.1:8080/ipfs}")
    private String ipfsGatewayUrl;
    @Value("${ipfs.upload.connect-timeout-ms:10000}")
    private int ipfsUploadConnectTimeoutMs;
    @Value("${ipfs.upload.read-timeout-ms:300000}")
    private int ipfsUploadReadTimeoutMs;
    private static final String KEY_FILE = "data/keys.dat";
    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH = 128; // bits
    private static final int IV_LENGTH = 12; // bytes
    private static final int KEY_LENGTH = 256; // bits
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final Map<String, EncryptionKeyInfo> keyStore = new ConcurrentHashMap<>();
    public static class EncryptionKeyInfo {
        public final byte[] key;
        public final byte[] iv;
        public EncryptionKeyInfo(byte[] key, byte[] iv) {
            this.key = key;
            this.iv = iv;
        }
    }

    public IpfsService() {
        loadKeys();
    }

    // ================================================================
    // UPLOAD
    // ================================================================

    /**
     * Encrypt the file with AES-256-GCM
     * @param filename  The original filename (metadata, not encrypted)
     * @param fileBytes The plaintext file content
     * @return The IPFS CID of the ENCRYPTED file
     */
    public String upload(String filename, byte[] fileBytes) throws Exception {
        return upload(filename, fileBytes, null);
    }

    public String upload(String filename, byte[] fileBytes, String fileId) throws Exception {
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(KEY_LENGTH, SECURE_RANDOM);
        SecretKey secretKey = keyGen.generateKey();
        byte[] iv = new byte[IV_LENGTH];
        SECURE_RANDOM.nextBytes(iv);
        // Encrypt
        Cipher cipher = Cipher.getInstance(ALGORITHM);
        GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, gcmSpec);
        byte[] ciphertext = cipher.doFinal(fileBytes);
        String cid = uploadToIpfs(filename, ciphertext);
        // Store key for this CID
        String keyId = fileId != null ? fileId : cid;
        EncryptionKeyInfo keyInfo = new EncryptionKeyInfo(secretKey.getEncoded(), iv);
        keyStore.put(keyId, keyInfo);
        if (fileId != null) {
            keyStore.put(cid, keyInfo);
        }
        saveKeys();

        System.out.println("[IpfsService] Encrypted upload: " + filename
                + " -> CID: " + cid
                + " | plaintext=" + fileBytes.length + "B"
                + " | ciphertext=" + ciphertext.length + "B"
                + " | AES-256-GCM");
        return cid;
    }

    // ================================================================
    // DOWNLOAD
    // ================================================================

    /**
     * Fetch encrypted content from IPFS and decrypt it.
     *
     * @param cid    The IPFS CID
     * @param fileId The file registry ID
     * @return Decrypted file bytes, or raw bytes if no key found
     */
    public byte[] downloadAndDecrypt(String cid, String fileId) throws Exception {
        byte[] ciphertext = downloadRaw(cid);

        // CID verification: Kubo's gateway/API cat returns file bytes, while
        // CIDv0 identifies the UnixFS DAG node created by "ipfs add". Re-run
        // the importer in only-hash mode and compare that CID before decrypt.
        if (cid != null && cid.startsWith("Qm") && cid.length() == 46) {
            String observed = computeUnixFsCidV0(ciphertext);
            if (!observed.equals(cid)) {
                throw new SecurityException("IPFS multihash mismatch: requested=" + cid
                        + " observed=" + observed + " - refusing to deliver tampered bytes");
            }
        }

        EncryptionKeyInfo keyInfo = keyStore.get(fileId);
        if (keyInfo == null) keyInfo = keyStore.get(cid);
        if (keyInfo == null) {
            // Refuse: returning raw on a missing key was fail-open. The
            // gateway never serves un-keyed bytes unless an explicit legacy
            // exemption is set on the registry entry — and even that path
            // would route through approveLegacyFile, not here.
            throw new SecurityException("No encryption key registered for CID " + cid
                    + " (fileId=" + fileId + ") - refusing legacy-raw fallback");
        }

        // Decrypt — GCM tag failure is treated as tamper, not as a hint to
        // fall back to ciphertext. We surface the failure to the caller.
        SecretKeySpec keySpec = new SecretKeySpec(keyInfo.key, "AES");
        Cipher cipher = Cipher.getInstance(ALGORITHM);
        GCMParameterSpec gcmSpec = new GCMParameterSpec(GCM_TAG_LENGTH, keyInfo.iv);
        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec);
        byte[] plaintext = cipher.doFinal(ciphertext);
        System.out.println("[IpfsService] Decrypted: CID=" + cid + " | ciphertext=" + ciphertext.length
                + "B | plaintext=" + plaintext.length + "B");
        return plaintext;
    }

    private String computeUnixFsCidV0(byte[] data) throws IOException {
        String boundary = "----CaacVerify" + System.currentTimeMillis();
        String url = buildApiAddUrl(true);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(30000);

        try (OutputStream out = conn.getOutputStream()) {
            String header = "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"file\"; filename=\"verify.bin\"\r\n"
                    + "Content-Type: application/octet-stream\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.UTF_8));
            out.write(data);
            out.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }

        int status = conn.getResponseCode();
        if (status != 200) {
            String errorPreview = readErrorPreview(conn.getErrorStream());
            throw new IOException("IPFS only-hash verification failed: HTTP " + status
                    + (errorPreview.isEmpty() ? "" : " (" + errorPreview + ")"));
        }

        String response;
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            response = sb.toString();
        }

        String observed = extractJsonValue(response, "Hash");
        if (observed == null || observed.isEmpty()) {
            throw new IOException("IPFS only-hash verification returned no CID: " + response);
        }
        return observed;
    }

    public byte[] downloadRaw(String cid) throws Exception {
        List<String> failures = new ArrayList<>();
        for (String gateway : buildGatewayCandidates()) {
            String url = gateway + "/" + cid;
            try {
                byte[] data = downloadFromUrl(url);
                if (data.length == 0) {
                    failures.add(url + " -> empty response body");
                    continue;
                }
                return data;
            } catch (Exception e) {
                failures.add(url + " -> " + e.getMessage());
            }
        }

        // Last fallback: query Kubo API directly (works even when gateway port is mismatched)
        String apiCatUrl = buildApiCatUrl(cid);
        try {
            byte[] data = downloadFromUrl(apiCatUrl, "POST");
            if (data.length == 0) {
                failures.add(apiCatUrl + " -> empty response body");
            } else {
                System.out.println("[IpfsService] Downloaded via API fallback: " + cid + " (" + data.length + " bytes)");
                return data;
            }
        } catch (Exception e) {
            failures.add(apiCatUrl + " -> " + e.getMessage());
        }

        throw new IOException("IPFS download failed for CID " + cid + ". Attempts: " + String.join("; ", failures));
    }

    // ================================================================
    // RAW IPFS UPLOAD (internal)
    // ================================================================

    private String uploadToIpfs(String filename, byte[] data) throws Exception {
        String boundary = "----CaacUpload" + System.currentTimeMillis();
        String url = buildApiAddUrl(false);
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        conn.setConnectTimeout(ipfsUploadConnectTimeoutMs);
        conn.setReadTimeout(ipfsUploadReadTimeoutMs);

        byte[] headerBytes = ("--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\""
                + filename + "\"\r\n"
                + "Content-Type: application/octet-stream\r\n\r\n").getBytes();
        byte[] footerBytes = ("\r\n--" + boundary + "--\r\n").getBytes();
        conn.setFixedLengthStreamingMode((long) headerBytes.length + data.length + footerBytes.length);
        try (OutputStream out = conn.getOutputStream()) {
            out.write(headerBytes);
            out.write(data);
            out.write(footerBytes);
            out.flush();
        }

        int status = conn.getResponseCode();
        if (status != 200) {
            throw new RuntimeException("IPFS upload failed: HTTP " + status);
        }

        String response;
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            response = sb.toString();
        }

        String cid = extractJsonValue(response, "Hash");
        if (cid == null || cid.isEmpty()) {
            throw new RuntimeException("IPFS returned no CID: " + response);
        }
        return cid;
    }

    private List<String> buildGatewayCandidates() {
        Set<String> candidates = new LinkedHashSet<>();
        candidates.add(normalizeGatewayBase(ipfsGatewayUrl));
        candidates.add(normalizeGatewayBase("http://127.0.0.1:8080/ipfs"));
        candidates.add(normalizeGatewayBase("http://localhost:8080/ipfs"));
        candidates.add(normalizeGatewayBase("http://127.0.0.1:8082/ipfs"));
        candidates.add(normalizeGatewayBase("http://localhost:8082/ipfs"));
        candidates.remove(null);
        return new ArrayList<>(candidates);
    }

    private String normalizeGatewayBase(String gateway) {
        if (gateway == null || gateway.isBlank()) return null;
        String value = gateway.trim();
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        if (!value.endsWith("/ipfs")) {
            value = value + "/ipfs";
        }
        return value;
    }

    private String buildApiCatUrl(String cid) {
        String base = ipfsApiUrl != null ? ipfsApiUrl.trim() : "";
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String encodedCid = URLEncoder.encode(cid, StandardCharsets.UTF_8);
        return base + "/api/v0/cat?arg=" + encodedCid;
    }

    private String buildApiAddUrl(boolean onlyHash) {
        String base = ipfsApiUrl != null ? ipfsApiUrl.trim() : "";
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String url = base + "/api/v0/add";
        if (onlyHash) {
            return url + "?only-hash=true&pin=false&cid-version=0&raw-leaves=false";
        }
        return url;
    }

    private byte[] downloadFromUrl(String url) throws IOException {
        return downloadFromUrl(url, "GET");
    }

    private byte[] downloadFromUrl(String url, String method) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(30000);

        int status = conn.getResponseCode();
        if (status != 200) {
            String errorPreview = readErrorPreview(conn.getErrorStream());
            throw new IOException("HTTP " + status + (errorPreview.isEmpty() ? "" : " (" + errorPreview + ")"));
        }

        try (InputStream in = conn.getInputStream();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    private String readErrorPreview(InputStream errorStream) {
        if (errorStream == null) return "";
        try (InputStream in = errorStream;
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[256];
            int total = 0;
            int n;
            while (total < 1024 && (n = in.read(buffer, 0, Math.min(buffer.length, 1024 - total))) != -1) {
                out.write(buffer, 0, n);
                total += n;
            }
            String text = out.toString(StandardCharsets.UTF_8);
            text = text.replaceAll("\\s+", " ").trim();
            return text.length() > 180 ? text.substring(0, 180) + "..." : text;
        } catch (Exception ignored) {
            return "";
        }
    }

    // ================================================================
    // KEY PERSISTENCE
    // ================================================================

    private void saveKeys() {
        try {
            java.nio.file.Files.createDirectories(java.nio.file.Paths.get("data"));
            try (PrintWriter writer = new PrintWriter(new FileWriter(KEY_FILE))) {
                for (Map.Entry<String, EncryptionKeyInfo> entry : keyStore.entrySet()) {
                    writer.println(entry.getKey() + "|" + Base64.getEncoder().encodeToString(entry.getValue().key) + "|"
                            + Base64.getEncoder().encodeToString(entry.getValue().iv));
                }
            }
        } catch (IOException e) {
            System.err.println("[IpfsService] Failed to save keys: " + e.getMessage());
        }
    }

    private void loadKeys() {
        java.nio.file.Path path = java.nio.file.Paths.get(KEY_FILE);
        if (!java.nio.file.Files.exists(path)) return;
        try (BufferedReader reader = java.nio.file.Files.newBufferedReader(path)) {
            String line;
            int count = 0;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                String[] parts = line.split("\\|", 3);
                if (parts.length < 3) continue;
                byte[] key = Base64.getDecoder().decode(parts[1]);
                byte[] iv = Base64.getDecoder().decode(parts[2]);
                keyStore.put(parts[0], new EncryptionKeyInfo(key, iv));
                count++;
            }
            if (count > 0) {
                System.out.println("[IpfsService] Loaded " + count + " encryption keys from disk");
            }
        } catch (Exception e) {
            System.err.println("[IpfsService] Failed to load keys: " + e.getMessage());
        }
    }

    // ================================================================
    // UTILITY
    // ================================================================

    private String extractJsonValue(String json, String key) {
        String search = "\"" + key + "\":\"";
        int start = json.indexOf(search);
        if (start == -1) return null;
        start += search.length();
        int end = json.indexOf("\"", start);
        if (end == -1) return null;
        return json.substring(start, end);
    }

    // To check if a file has an encryption key
    public boolean hasEncryptionKey(String fileIdOrCid) {
        return keyStore.containsKey(fileIdOrCid);
    }
}
