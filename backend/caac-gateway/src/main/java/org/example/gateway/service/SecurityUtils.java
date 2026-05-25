package org.example.gateway.service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * SecurityUtils — Centralized cryptographic utility class.
 *
 * Provides:
 * - BCrypt password hashing
 * - HMAC-SHA256 for audit log integrity and oracle request signing
 * - SHA-256 for tokens/OTPs
 * - Constant-time comparison to prevent timing attacks
 *
 */
public final class SecurityUtils {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private SecurityUtils() {}

    // ================================================================
    // BCrypt PASSWORD HASHING
    // ================================================================

    /**
     * Output format: $2a$12$[22-char salt][31-char hash] (60 chars total)
     * Cost 12 ≈ 250ms per hash, so it makes brute-force infeasible:
     * GPU: ~100 BCrypt/sec vs ~10 billion SHA-256/sec
     */
    public static String bcryptHash(String password) {
        return org.mindrot.jbcrypt.BCrypt.hashpw(password, org.mindrot.jbcrypt.BCrypt.gensalt(12));
    }

    public static boolean bcryptCheck(String password, String hash) {
        try {
            return org.mindrot.jbcrypt.BCrypt.checkpw(password, hash);
        } catch (Exception e) {
            return false;
        }
    }

    public static boolean isBcryptHash(String hash) {
        return hash != null && (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$"));
    }

    // ================================================================
    // SHA-256 (For tokens, OTPs, verification codes)(NOT for passwords!)
    // ================================================================

    public static String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    // SHA-256 with salt
    public static String sha256WithSalt(String input, String salt) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt.getBytes(StandardCharsets.UTF_8));
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    // ================================================================
    // HMAC-SHA256 - (Audit logs and oracle request signing)
    // ================================================================

    /**
     * Computes HMAC-SHA256(key, data)
     * @param key The shared secret key
     * @param data The data to sign
     * @return Hex-encoded HMAC string
     */
    public static String hmacSha256(String key, String data) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            SecretKeySpec keySpec = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), HMAC_ALGORITHM);
            mac.init(keySpec);
            byte[] hmacBytes = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hmacBytes);
        } catch (Exception e) {
            throw new RuntimeException("HMAC-SHA256 computation failed", e);
        }
    }

    public static boolean verifyHmac(String key, String data, String expectedHmac) {
        String computed = hmacSha256(key, data);
        return constantTimeEquals(computed, expectedHmac);
    }

    // ================================================================
    // NONCE GENERATION
    // ================================================================

    /**
     * Generates a cryptographically secure random nonce
     * @return 32-character hex nonce (128 bits of entropy)
     */
    public static String generateNonce() {
        byte[] nonce = new byte[16];
        SECURE_RANDOM.nextBytes(nonce);
        return bytesToHex(nonce);
    }

    /**
     * Generates a cryptographic salt for password hashing.
     * @return 32-character hex salt (128 bits)
     */
    public static String generateSalt() {
        byte[] salt = new byte[16];
        SECURE_RANDOM.nextBytes(salt);
        return bytesToHex(salt);
    }

    // ================================================================
    // INTERNAL UTILITIES
    // ================================================================

    public static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] aBytes = a.getBytes(StandardCharsets.UTF_8);
        byte[] bBytes = b.getBytes(StandardCharsets.UTF_8);
        if (aBytes.length != bBytes.length) return false;
        int result = 0;
        for (int i = 0; i < aBytes.length; i++) {
            result |= aBytes[i] ^ bBytes[i];
        }
        return result == 0;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
