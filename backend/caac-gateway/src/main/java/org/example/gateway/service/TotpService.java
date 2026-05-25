package org.example.gateway.service;

import org.springframework.stereotype.Service;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * TotpService - Time-based One-Time Password for Admin 2FA
 *
 *
 * Security properties:
 * - 30-second time window per code
 * - ±1 window tolerance (accounts for clock skew)
 * - Per-user secret key (160 bits = 20 bytes)
 * - HMAC-SHA1 (standard for TOTP compatibility)
 */
@Service
public class TotpService {

    private static final int CODE_DIGITS = 6;
    private static final int TIME_STEP_SECONDS = 30;
    private static final int WINDOW_SIZE = 1;
    private static final int SECRET_LENGTH = 20;
    private static final String TOTP_FILE = "data/totp.dat";
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private final Map<String, TotpInfo> totpStore = new ConcurrentHashMap<>();
    public static class TotpInfo {
        public final String secretBase32;
        public boolean enabled;
        public TotpInfo(String secretBase32, boolean enabled) {
            this.secretBase32 = secretBase32;
            this.enabled = enabled;
        }
    }

    public TotpService() {
        loadFromDisk();
        System.out.println("[TotpService] Loaded " + totpStore.size() + " TOTP configurations");
    }

    // ================================================================
    // SETUP
    // ================================================================

    public String generateSecret(String username) {
        byte[] secret = new byte[SECRET_LENGTH];
        SECURE_RANDOM.nextBytes(secret);
        String base32Secret = encodeBase32(secret);
        totpStore.put(username.toLowerCase(), new TotpInfo(base32Secret, false));
        saveToDisk();
        System.out.println("[TotpService] Generated TOTP secret for " + username);
        return base32Secret;
    }

    /**
     * Generates the otpauth:// URI for QR code scanning
     * Format: otpauth://totp/CAAC:{username}?secret={base32}&issuer=CAAC&digits=6&period=30
     */
    public String getProvisioningUri(String username, String secret) {
        return "otpauth://totp/CAAC:" + username + "?secret=" + secret + "&issuer=CAAC" + "&digits=" + CODE_DIGITS + "&period=" + TIME_STEP_SECONDS;
    }

    public boolean confirmSetup(String username, String code) {
        TotpInfo info = totpStore.get(username.toLowerCase());
        if (info == null) return false;
        if (verifyCode(info.secretBase32, code)) {
            info.enabled = true;
            saveToDisk();
            System.out.println("[TotpService] TOTP ENABLED for " + username);
            return true;
        }
        System.out.println("[TotpService] TOTP confirmation failed for " + username);
        return false;
    }

    // ================================================================
    // VERIFICATION
    // ================================================================

    public boolean verify(String username, String code) {
        TotpInfo info = totpStore.get(username.toLowerCase());
        if (info == null || !info.enabled) return false;
        return verifyCode(info.secretBase32, code);
    }

    public boolean isEnabled(String username) {
        TotpInfo info = totpStore.get(username.toLowerCase());
        return info != null && info.enabled;
    }

    public boolean isPending(String username) {
        TotpInfo info = totpStore.get(username.toLowerCase());
        return info != null && !info.enabled;
    }

    public boolean disable(String username) {
        TotpInfo removed = totpStore.remove(username.toLowerCase());
        if (removed != null) {
            saveToDisk();
            System.out.println("[TotpService] TOTP disabled for " + username);
            return true;
        }
        return false;
    }

    // ================================================================
    // TOTP ALGORITHM
    // ================================================================

    private boolean verifyCode(String base32Secret, String code) {
        if (code == null || code.length() != CODE_DIGITS) return false;
        byte[] secretBytes = decodeBase32(base32Secret);
        long currentStep = Instant.now().getEpochSecond() / TIME_STEP_SECONDS;
        for (int i = -WINDOW_SIZE; i <= WINDOW_SIZE; i++) {
            String expected = generateCode(secretBytes, currentStep + i);
            if (SecurityUtils.constantTimeEquals(expected, code)) {
                return true;
            }
        }
        return false;
    }

    private String generateCode(byte[] secret, long timeStep) {
        try {
            byte[] timeBytes = ByteBuffer.allocate(8).putLong(timeStep).array();
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secret, "HmacSHA1"));
            byte[] hash = mac.doFinal(timeBytes);
            int offset = hash[hash.length - 1] & 0x0F;
            int binary = ((hash[offset] & 0x7F) << 24) | ((hash[offset + 1] & 0xFF) << 16)
                    | ((hash[offset + 2] & 0xFF) << 8) | (hash[offset + 3] & 0xFF);
            int otp = binary % (int) Math.pow(10, CODE_DIGITS);
            return String.format("%0" + CODE_DIGITS + "d", otp);
        } catch (Exception e) {
            throw new RuntimeException("TOTP generation failed", e);
        }
    }

    // ================================================================
    // BASE32 ENCODING/DECODING
    // ================================================================

    private String encodeBase32(byte[] data) {
        StringBuilder result = new StringBuilder();
        int buffer = 0, bitsLeft = 0;
        for (byte b : data) {
            buffer = (buffer << 8) | (b & 0xFF);
            bitsLeft += 8;
            while (bitsLeft >= 5) {
                result.append(BASE32_CHARS.charAt((buffer >> (bitsLeft - 5)) & 0x1F));
                bitsLeft -= 5;
            }
        }

        if (bitsLeft > 0) {
            result.append(BASE32_CHARS.charAt((buffer << (5 - bitsLeft)) & 0x1F));
        }
        return result.toString();
    }

    private byte[] decodeBase32(String base32) {
        String upper = base32.toUpperCase().replaceAll("[^A-Z2-7]", "");
        byte[] output = new byte[upper.length() * 5 / 8];
        int buffer = 0, bitsLeft = 0, index = 0;
        for (char c : upper.toCharArray()) {
            int val = BASE32_CHARS.indexOf(c);
            if (val < 0) continue;
            buffer = (buffer << 5) | val;
            bitsLeft += 5;
            if (bitsLeft >= 8) {
                output[index++] = (byte) (buffer >> (bitsLeft - 8));
                bitsLeft -= 8;
            }
        }
        return output;
    }

    // ================================================================
    // PERSISTENCE
    // ================================================================

    private void saveToDisk() {
        try {
            java.nio.file.Files.createDirectories(java.nio.file.Paths.get("data"));
            try (java.io.PrintWriter writer = new java.io.PrintWriter(new java.io.FileWriter(TOTP_FILE))) {
                for (Map.Entry<String, TotpInfo> entry : totpStore.entrySet()) {
                    writer.println(entry.getKey() + "|" + entry.getValue().secretBase32 + "|" + entry.getValue().enabled);
                }
            }
        } catch (Exception e) {
            System.err.println("[TotpService] Save failed: " + e.getMessage());
        }
    }

    private void loadFromDisk() {
        java.nio.file.Path path = java.nio.file.Paths.get(TOTP_FILE);
        if (!java.nio.file.Files.exists(path)) return;
        try (java.io.BufferedReader reader = java.nio.file.Files.newBufferedReader(path)) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty()) continue;
                String[] parts = line.split("\\|", 3);
                if (parts.length < 3) continue;
                totpStore.put(parts[0], new TotpInfo(parts[1], Boolean.parseBoolean(parts[2])));
            }
        } catch (Exception e) {
            System.err.println("[TotpService] Load failed: " + e.getMessage());
        }
    }
}
