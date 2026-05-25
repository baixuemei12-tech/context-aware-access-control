package org.example.oracle.controller;

import org.example.oracle.service.CAACService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Oracle AccessController (v3.0 + BV-GCA CAAR)
 *
 * HMAC-verifies three headers on every request:
 *   X-CAAC-Timestamp: must be within +/-5 minutes
 *   X-CAAC-Nonce: must not have been seen before (replay protection)
 *   X-CAAC-Signature: HMAC-SHA256(shared_key, canonical_payload|timestamp|nonce)
 *
 * Endpoints:
 *   POST /api/access/evaluate        — Algorithm 1 (EVALUATE)
 *   POST /api/access/receipt/submit   — BV-GCA CAAR receipt write (SUBMIT)
 *   POST /api/access/receipt/query    — BV-GCA CAAR receipt read (EVALUATE)
 */
@RestController
@RequestMapping("/api/access")
public class AccessController {

    private final CAACService caacService;
    @Value("${oracle.hmac.key}")
    private String configHmacKey;
    private String hmacKey;

    private final ConcurrentHashMap<String, Long> seenNonces = new ConcurrentHashMap<>();
    private static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(5);
    private static final long NONCE_TTL_MS = MAX_CLOCK_SKEW.toMillis() * 2;
    private static final int MAX_NONCE_CACHE = 10_000;
    private static final long EVICT_INTERVAL_MS = 60_000;
    private volatile long lastEviction = 0L;

    public AccessController(CAACService caacService) {
        this.caacService = caacService;
    }

    private String getHmacKey() {
        if (hmacKey == null) {
            String envKey = System.getenv("CAAC_ORACLE_HMAC_KEY");
            if (envKey != null && !envKey.isEmpty()) {
                hmacKey = envKey;
                System.out.println("[Oracle] HMAC verification ENABLED (key from environment)");
            } else if (configHmacKey != null && !configHmacKey.isEmpty()) {
                hmacKey = configHmacKey;
                System.out.println("[Oracle] HMAC verification ENABLED (key from config)");
            } else {
                throw new IllegalStateException("No oracle HMAC key configured. Set CAAC_ORACLE_HMAC_KEY.");
            }
        }
        return hmacKey;
    }

    /**
     * Verify HMAC headers. Returns null on success, error ResponseEntity on failure.
     * Shared by all endpoints — single verification path, no code duplication.
     */
    private ResponseEntity<String> verifyHmac(Map<String, String> payload,
                                               String timestamp, String nonce, String signature) {
        String key = getHmacKey();
        if (timestamp == null || nonce == null || signature == null) {
            System.out.println("[Oracle] REJECTED: Missing HMAC headers");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("DENY|0.0|0.0");
        }
        try {
            Instant requestTime = Instant.parse(timestamp);
            Duration age = Duration.between(requestTime, Instant.now()).abs();
            if (age.compareTo(MAX_CLOCK_SKEW) > 0) {
                System.out.println("[Oracle] REJECTED: Timestamp too old/future: " + age.toSeconds() + "s");
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("DENY|0.0|0.0");
            }
        } catch (Exception e) {
            System.out.println("[Oracle] REJECTED: Invalid timestamp format");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("DENY|0.0|0.0");
        }

        long nowMs = System.currentTimeMillis();
        evictOldNonces(nowMs);
        Long seenAt = seenNonces.get(nonce);
        if (seenAt != null && (nowMs - seenAt) <= NONCE_TTL_MS) {
            System.out.println("[Oracle] REJECTED: Replayed nonce: " + nonce);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("DENY|0.0|0.0");
        }

        String canonical = canonicalize(payload);
        String signatureData = canonical + "|" + timestamp + "|" + nonce;
        String expectedSignature = hmacSha256(key, signatureData);
        if (!constantTimeEquals(expectedSignature, signature)) {
            System.out.println("[Oracle] REJECTED: Invalid HMAC signature");
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("DENY|0.0|0.0");
        }

        seenNonces.put(nonce, nowMs);
        return null; // success
    }

    // ================================================================
    // ALGORITHM 1 — ACCESS EVALUATION
    // ================================================================

    @PostMapping("/evaluate")
    public ResponseEntity<String> evaluateAccess(
            @RequestBody Map<String, String> payload,
            @RequestHeader(value = "X-CAAC-Timestamp", required = false) String timestamp,
            @RequestHeader(value = "X-CAAC-Nonce", required = false) String nonce,
            @RequestHeader(value = "X-CAAC-Signature", required = false) String signature) {

        ResponseEntity<String> authError = verifyHmac(payload, timestamp, nonce, signature);
        if (authError != null) return authError;

        if (payload.size() > 32) {
            return ResponseEntity.badRequest().body("DENY|0.0|0.0");
        }

        String[] required = {"rSub", "tSub", "bFreq", "sLevel", "pReq", "lTrust", "nStatus", "dSec", "tReq", "w1", "w2", "w3", "alpha", "beta", "lambda", "tau"};
        for (String key : required) {
            String val = payload.get(key);
            if (val == null || val.isEmpty()) {
                return ResponseEntity.badRequest().body("DENY|0.0|0.0");
            }
            if (val.length() > 32) {
                return ResponseEntity.badRequest().body("DENY|0.0|0.0");
            }
            try {
                if (!key.equals("tReq") || !"true".equalsIgnoreCase(val) && !"false".equalsIgnoreCase(val)) {
                    Double.parseDouble(val);
                }
            } catch (NumberFormatException e) {
                return ResponseEntity.badRequest().body("DENY|0.0|0.0");
            }
        }

        System.out.println("[Oracle] HMAC verified OK — processing evaluate request");

        String result = caacService.evaluateAccessRequest(
                payload.get("rSub"), payload.get("tSub"), payload.get("bFreq"),
                payload.get("sLevel"), payload.get("pReq"),
                payload.get("lTrust"), payload.get("nStatus"), payload.get("dSec"),
                payload.get("tReq"),
                payload.get("w1"), payload.get("w2"), payload.get("w3"),
                payload.get("alpha"), payload.get("beta"),
                payload.get("lambda"), payload.get("tau"));
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // BV-GCA CAAR — SESSION RECEIPT SUBMISSION
    // ================================================================

    /**
     * Submit a session receipt to the blockchain.
     * HMAC-verified — only the gateway can call this.
     * Called once per session close (not per polling cycle).
     */
    @PostMapping("/receipt/submit")
    public ResponseEntity<String> submitReceipt(
            @RequestBody Map<String, String> payload,
            @RequestHeader(value = "X-CAAC-Timestamp", required = false) String timestamp,
            @RequestHeader(value = "X-CAAC-Nonce", required = false) String nonce,
            @RequestHeader(value = "X-CAAC-Signature", required = false) String signature) {

        ResponseEntity<String> authError = verifyHmac(payload, timestamp, nonce, signature);
        if (authError != null) return authError;

        if (payload.size() > 16) {
            return ResponseEntity.badRequest().body("ERROR");
        }

        for (Map.Entry<String, String> entry : payload.entrySet()) {
            if (entry.getValue() != null && entry.getValue().length() > 128) {
                return ResponseEntity.badRequest().body("ERROR");
            }
        }

        System.out.println("[Oracle] HMAC verified OK — processing CAAR receipt");

        String result = caacService.submitReceipt(
                payload.getOrDefault("sessionHash", ""),
                payload.getOrDefault("userHash", ""),
                payload.getOrDefault("fileId", ""),
                payload.getOrDefault("rgcaTier", "UNKNOWN"),
                payload.getOrDefault("bytesDelivered", "0"),
                payload.getOrDefault("wasRevoked", "false"),
                payload.getOrDefault("leakageBound", "0"),
                payload.getOrDefault("budgetUsed", "0"),
                payload.getOrDefault("budgetLimit", "0"),
                payload.getOrDefault("clusterRisk", "0.0"),
                payload.getOrDefault("compliant", "false"));

        if (result.startsWith("ERROR")) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(result);
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Query a session receipt from the blockchain.
     * HMAC-verified. Returns receipt JSON or "NOT_FOUND".
     */
    @PostMapping("/receipt/query")
    public ResponseEntity<String> queryReceipt(
            @RequestBody Map<String, String> payload,
            @RequestHeader(value = "X-CAAC-Timestamp", required = false) String timestamp,
            @RequestHeader(value = "X-CAAC-Nonce", required = false) String nonce,
            @RequestHeader(value = "X-CAAC-Signature", required = false) String signature) {

        ResponseEntity<String> authError = verifyHmac(payload, timestamp, nonce, signature);
        if (authError != null) return authError;

        String sessionHash = payload.getOrDefault("sessionHash", "");
        if (sessionHash.isEmpty()) {
            return ResponseEntity.badRequest().body("Missing sessionHash");
        }
        String receipt = caacService.getReceipt(sessionHash);
        return ResponseEntity.ok(receipt);
    }

    // ================================================================
    // CRYPTO UTILITIES
    // ================================================================

    private String canonicalize(Map<String, String> payload) {
        if (payload == null) payload = Map.of();
        TreeMap<String, String> sorted = new TreeMap<>();
        for (Map.Entry<String, String> entry : payload.entrySet()) {
            sorted.put(entry.getKey(), Objects.toString(entry.getValue(), ""));
        }
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : sorted.entrySet()) {
            if (sb.length() > 0) sb.append("&");
            sb.append(entry.getKey()).append("=").append(entry.getValue());
        }
        return sb.toString();
    }

    private String hmacSha256(String key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(keySpec);
            byte[] hmacBytes = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hmacBytes.length * 2);
            for (byte b : hmacBytes) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException("HMAC-SHA256 failed", e);
        }
    }

    private boolean constantTimeEquals(String a, String b) {
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

    private void evictOldNonces(long nowMs) {
        if ((nowMs - lastEviction) < EVICT_INTERVAL_MS && seenNonces.size() <= MAX_NONCE_CACHE) return;
        long before = seenNonces.size();
        seenNonces.entrySet().removeIf(entry -> (nowMs - entry.getValue()) > NONCE_TTL_MS);
        if (seenNonces.size() > MAX_NONCE_CACHE) {
            seenNonces.entrySet().removeIf(entry -> (nowMs - entry.getValue()) > (NONCE_TTL_MS / 2));
        }
        lastEviction = nowMs;
        long removed = before - seenNonces.size();
        if (removed > 0) System.out.println("[Oracle] Evicted " + removed + " expired nonce(s)");
    }
}
