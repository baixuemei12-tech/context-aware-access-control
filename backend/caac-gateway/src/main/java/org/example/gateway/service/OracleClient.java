package org.example.gateway.service;

import org.example.gateway.model.AccessRequest;
import org.example.gateway.model.OracleResult;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.*;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * OracleClient (v3.0 + BV-GCA CAAR)
 *
 * Every request to the Oracle includes HMAC-SHA256 headers:
 *   X-CAAC-Timestamp: ISO 8601 timestamp
 *   X-CAAC-Nonce: 128-bit random nonce
 *   X-CAAC-Signature: HMAC-SHA256(shared_secret, canonical_payload|timestamp|nonce)
 *
 * Methods:
 *   evaluate()      — Algorithm 1 access decision (EVALUATE)
 *   submitReceipt() — BV-GCA CAAR receipt submission (SUBMIT)
 */
@Service
public class OracleClient {

    private final RestTemplate restTemplate;

    @Value("${oracle.url:http://localhost:5050/api/access/evaluate}")
    private String oracleUrl;

    @Value("${oracle.hmac.key}")
    private String configHmacKey;

    private String hmacKey;

    public OracleClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    private String getHmacKey() {
        if (hmacKey == null) {
            String envKey = System.getenv("CAAC_ORACLE_HMAC_KEY");
            if (envKey != null && !envKey.isEmpty()) {
                hmacKey = envKey;
                System.out.println("[OracleClient] HMAC key from environment");
            } else if (configHmacKey != null && !configHmacKey.isEmpty()) {
                hmacKey = configHmacKey;
                System.out.println("[OracleClient] HMAC key from config");
            } else {
                throw new IllegalStateException("No oracle HMAC key configured. Set CAAC_ORACLE_HMAC_KEY.");
            }
        }
        return hmacKey;
    }

    private String canonicalize(Map<String, String> payload) {
        TreeMap<String, String> sorted = new TreeMap<>(payload);
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> entry : sorted.entrySet()) {
            if (sb.length() > 0) sb.append("&");
            sb.append(entry.getKey()).append("=").append(entry.getValue());
        }
        return sb.toString();
    }

    /**
     * Sign a payload with HMAC headers and build an HttpEntity.
     * Shared by evaluate() and submitReceipt() — single signing path.
     */
    private HttpEntity<Map<String, String>> signRequest(Map<String, String> payload) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        String key = getHmacKey();
        String timestamp = Instant.now().toString();
        String nonce = SecurityUtils.generateNonce();
        String canonical = canonicalize(payload);
        String signatureData = canonical + "|" + timestamp + "|" + nonce;
        String signature = SecurityUtils.hmacSha256(key, signatureData);
        headers.set("X-CAAC-Timestamp", timestamp);
        headers.set("X-CAAC-Nonce", nonce);
        headers.set("X-CAAC-Signature", signature);
        return new HttpEntity<>(payload, headers);
    }

    // ================================================================
    // ALGORITHM 1 — ACCESS EVALUATION
    // ================================================================

    public OracleResult evaluate(AccessRequest request) {
        try {
            Map<String, String> payload = new LinkedHashMap<>();
            payload.put("rSub",    request.getRSub());
            payload.put("tSub",    request.getTSub());
            payload.put("bFreq",   request.getBFreq());
            payload.put("sLevel",  request.getSLevel());
            payload.put("pReq",    request.getPReq());
            payload.put("lTrust",  request.getLTrust());
            payload.put("nStatus", request.getNStatus());
            payload.put("dSec",    request.getDSec());
            payload.put("tReq",    request.getTReq());
            payload.put("w1",      request.getW1());
            payload.put("w2",      request.getW2());
            payload.put("w3",      request.getW3());
            payload.put("alpha",   request.getAlpha());
            payload.put("beta",    request.getBeta());
            payload.put("lambda",  request.getLambda());
            payload.put("tau",     request.getTau());

            HttpEntity<Map<String, String>> entity = signRequest(payload);
            ResponseEntity<String> response = restTemplate.exchange(oracleUrl, HttpMethod.POST, entity, String.class);
            String raw = response.getBody();
            OracleResult result = OracleResult.parse(raw);
            System.out.println("[OracleClient] Response: " + (raw != null ? raw.trim() : "null") + " (HMAC-signed)");
            return result;

        } catch (Exception e) {
            System.err.println("[OracleClient] ERROR: Could not reach Oracle at " + oracleUrl);
            System.err.println("[OracleClient] Reason: " + e.getMessage());
            System.err.println("[OracleClient] Defaulting to DENY (Zero-Trust fallback).");
            return new OracleResult("ERROR", 0.0, 0.0);
        }
    }

    // ================================================================
    // BV-GCA CAAR — RECEIPT SUBMISSION
    // ================================================================

    /**
     * Submit a session receipt to Oracle -> Fabric chaincode.
     * HMAC-signed like all oracle requests.
     *
     * Security:
     * - sessionHash/userHash are pre-hashed by caller (SHA-256) — no PII on wire
     * - Fail-safe: exceptions caught, never propagated to session close
     * - Zero-trust: HMAC headers required, replay-protected
     *
     * @return true on success, false on failure (logged, never thrown)
     */
    public boolean submitReceipt(String sessionHash, String userHash, String fileId,
                                   String rgcaTier, long bytesDelivered,
                                   boolean wasRevoked, long leakageBound,
                                   long budgetUsed, long budgetLimit,
                                   double clusterRisk, boolean compliant) {
        try {
            Map<String, String> payload = new LinkedHashMap<>();
            payload.put("sessionHash", sessionHash);
            payload.put("userHash", userHash);
            payload.put("fileId", fileId);
            payload.put("rgcaTier", rgcaTier);
            payload.put("bytesDelivered", String.valueOf(bytesDelivered));
            payload.put("wasRevoked", String.valueOf(wasRevoked));
            payload.put("leakageBound", String.valueOf(leakageBound));
            payload.put("budgetUsed", String.valueOf(budgetUsed));
            payload.put("budgetLimit", String.valueOf(budgetLimit));
            payload.put("clusterRisk", String.valueOf(clusterRisk));
            payload.put("compliant", String.valueOf(compliant));

            // Receipt endpoint: same host as evaluate, different path
            String receiptUrl = oracleUrl.replace("/api/access/evaluate", "/api/access/receipt/submit");

            HttpEntity<Map<String, String>> entity = signRequest(payload);
            ResponseEntity<String> response = restTemplate.exchange(receiptUrl, HttpMethod.POST, entity, String.class);

            boolean ok = response.getStatusCode().is2xxSuccessful();
            if (ok) {
                System.out.println("[CAAR-Gateway] Receipt submitted to blockchain: " + sessionHash);
            } else {
                System.err.println("[CAAR-Gateway] Receipt rejected: HTTP " + response.getStatusCode());
            }
            return ok;
        } catch (Exception e) {
            // Fail-safe: receipt failure must never break session close
            System.err.println("[CAAR-Gateway] Receipt submission error (non-fatal): " + e.getMessage());
            return false;
        }
    }

    /**
     * Query a CAAR receipt from Oracle/Fabric by hashed session ID.
     * The caller should pass the same SHA-256-short hash used during submission.
     */
    public String queryReceipt(String sessionHash) {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("sessionHash", sessionHash);

        String queryUrl = oracleUrl.replace("/api/access/evaluate", "/api/access/receipt/query");
        HttpEntity<Map<String, String>> entity = signRequest(payload);
        ResponseEntity<String> response = restTemplate.exchange(queryUrl, HttpMethod.POST, entity, String.class);

        if (!response.getStatusCode().is2xxSuccessful()) {
            throw new IllegalStateException("Receipt query failed: HTTP " + response.getStatusCode().value());
        }
        String body = response.getBody();
        return body != null ? body : "NOT_FOUND";
    }
}
