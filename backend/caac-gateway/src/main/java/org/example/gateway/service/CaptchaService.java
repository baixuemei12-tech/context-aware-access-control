package org.example.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * CaptchaService — hCaptcha with self-hosted math fallback.
 *
 * Math mode has zero external dependencies and works fully offline.
 * hCaptcha mode verifies response tokens against hCaptcha's siteverify API.
 *
 * Protocol:
 *   1. Frontend calls GET /api/auth/captcha-challenge
 *      Returns: { enabled, question: "What is 5 + 9?", token: "<signed>" }
 *   2. User types the numeric answer into a plain text input
 *   3. Frontend POSTs with: captchaToken=<token>&captchaAnswer=<user_input>
 *   4. Backend calls verify(token, answer) — validates HMAC + expiry + answer
 *
 * Token format (Base64url-encoded):
 *   answer|expiryEpochMs|hmacSHA256(answer|expiryEpochMs)
 *
 * Security properties:
 *   - Tokens expire after 5 minutes (TOKEN_TTL_MS)
 *   - HMAC prevents forgery — attacker cannot craft a valid token without the key
 *   - Fails secure: any parsing or HMAC error -> deny
 *   - Reuses existing CAAC_AUDIT_HMAC_KEY — no new secret required
 */
@Service
public class CaptchaService {

    @Value("${captcha.enabled:false}")
    private boolean enabled;

    @Value("${captcha.provider:math}")
    private String provider;

    @Value("${captcha.sitekey:}")
    private String hcaptchaSitekey;

    @Value("${captcha.secret:}")
    private String hcaptchaSecret;

    @Value("${captcha.verify-url:https://api.hcaptcha.com/siteverify}")
    private String hcaptchaVerifyUrl;

    /** Reuses the existing audit HMAC key — no new env var needed */
    @Value("${audit.hmac.key:fallback-change-in-production}")
    private String hmacKey;

    private static final long   TOKEN_TTL_MS = 5 * 60 * 1000L; // 5 minutes
    private static final SecureRandom RNG    = new SecureRandom();
    private static final int    MIN_OP       = 1;
    private static final int    MAX_OP       = 9;
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4))
            .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    // ================================================================
    // STEP 1 — Generate challenge
    // Called by GET /api/auth/captcha-challenge
    // ================================================================

    /**
     * Generates a simple addition question and a signed token.
     * Token encodes the correct answer + expiry so no server state is needed.
     *
     * @return map with keys: enabled, question, token
     */
    public Map<String, Object> getChallenge() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", enabled);
        result.put("type", "math");

        if (!enabled) {
            return result;
        }

        int a      = MIN_OP + RNG.nextInt(MAX_OP);
        int b      = MIN_OP + RNG.nextInt(MAX_OP);
        int answer = a + b;

        String question = "What is " + a + " + " + b + "?";
        String expiry   = String.valueOf(System.currentTimeMillis() + TOKEN_TTL_MS);
        String payload  = answer + "|" + expiry;

        try {
            String sig   = hmac(payload);
            String raw   = payload + "|" + sig;
            String token = Base64.getUrlEncoder().withoutPadding()
                                 .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
            result.put("question", question);
            result.put("token", token);
            System.out.println("[MathCaptcha] Challenge: " + question);
        } catch (Exception e) {
            System.err.println("[MathCaptcha] Token generation failed: " + e.getMessage());
            result.put("question", "Reload page to get CAPTCHA");
            result.put("token", "");
        }

        return result;
    }

    // ================================================================
    // STEP 2 — Verify answer
    // Called by AuthController /signup and /login handlers
    // ================================================================

    /**
     * Verifies a math captcha token + the user's typed answer.
     *
     * @param token       the signed token from getChallenge()
     * @param answerInput the raw string the user typed (e.g. "13")
     * @return true only if: HMAC valid AND not expired AND answer correct
     */
    public boolean verify(String token, String answerInput) {
        return verify(token, answerInput, null);
    }

    /**
     * Verifies the active CAPTCHA mode. hCaptcha is used when configured, while
     * the signed math challenge remains available as a no-CDN fallback.
     */
    public boolean verify(String token, String answerInput, String remoteIp) {
        if (!enabled) return true;

        if (!isBlank(answerInput)) {
            return verifyMath(token, answerInput);
        }

        if ("hcaptcha".equals(effectiveProvider())) {
            return verifyHCaptcha(token, remoteIp);
        }

        return verifyMath(token, answerInput);
    }

    public String getPublicType() {
        return effectiveProvider();
    }

    public String getPublicSitekey() {
        return "hcaptcha".equals(effectiveProvider()) ? hcaptchaSitekey : "";
    }

    public boolean isMathFallbackAvailable() {
        return enabled;
    }

    private boolean verifyMath(String token, String answerInput) {

        if (isBlank(token) || isBlank(answerInput)) {
            System.out.println("[MathCaptcha] Missing token or answer — FAIL");
            return false;
        }

        try {
            // Decode token
            byte[] decoded = Base64.getUrlDecoder().decode(token);
            String raw     = new String(decoded, StandardCharsets.UTF_8);

            // Format: answer|expiry|sig  (exactly 3 parts split on first two pipes)
            String[] parts = raw.split("\\|", 3);
            if (parts.length != 3) {
                System.out.println("[MathCaptcha] Malformed token — FAIL");
                return false;
            }

            String storedAnswer = parts[0];
            String expiryStr    = parts[1];
            String storedSig    = parts[2];

            // 1 — Verify HMAC first (constant-time via equalsIgnoreCase on hex)
            String expectedSig = hmac(storedAnswer + "|" + expiryStr);
            if (!constantTimeEquals(expectedSig, storedSig)) {
                System.out.println("[MathCaptcha] HMAC mismatch — tampered token — FAIL");
                return false;
            }

            // 2 — Check expiry
            long expiry = Long.parseLong(expiryStr);
            if (System.currentTimeMillis() > expiry) {
                System.out.println("[MathCaptcha] Token expired — FAIL");
                return false;
            }

            // 3 — Check answer (trim whitespace, numeric comparison)
            String normalized = answerInput.trim();
            boolean pass = storedAnswer.equals(normalized);

            System.out.println("[MathCaptcha] answer='" + normalized
                    + "' expected='" + storedAnswer + "' -> " + (pass ? "PASS" : "FAIL"));
            return pass;

        } catch (Exception e) {
            System.err.println("[MathCaptcha] Verify error: " + e.getMessage());
            return false; // fail secure
        }
    }

    private boolean verifyHCaptcha(String token, String remoteIp) {
        if (isBlank(token)) {
            System.out.println("[hCaptcha] Missing response token — FAIL");
            return false;
        }
        if (!isHcaptchaConfigured()) {
            System.out.println("[hCaptcha] Missing sitekey/secret config — FAIL");
            return false;
        }

        try {
            StringBuilder form = new StringBuilder()
                    .append("secret=").append(urlEncode(hcaptchaSecret))
                    .append("&response=").append(urlEncode(token));
            if (!isBlank(remoteIp)) {
                form.append("&remoteip=").append(urlEncode(remoteIp));
            }

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(hcaptchaVerifyUrl))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form.toString()))
                    .build();

            HttpResponse<String> response = HTTP_CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                System.out.println("[hCaptcha] Verify HTTP " + response.statusCode() + " — FAIL");
                return false;
            }

            JsonNode json = objectMapper.readTree(response.body());
            boolean ok = json.path("success").asBoolean(false);
            System.out.println("[hCaptcha] verification -> " + (ok ? "PASS" : "FAIL"));
            return ok;
        } catch (Exception e) {
            System.err.println("[hCaptcha] Verify error: " + e.getMessage());
            return false;
        }
    }

    // ================================================================
    // Helpers
    // ================================================================

    private String hmac(String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(
            hmacKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] raw = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(64);
        for (byte b : raw) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /**
     * Constant-time string comparison to prevent timing attacks on the HMAC.
     */
    private boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) return false;
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        if (ab.length != bb.length) return false;
        int diff = 0;
        for (int i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
        return diff == 0;
    }

    private boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private String effectiveProvider() {
        if (!enabled) return "math";

        String mode = provider == null ? "math" : provider.trim().toLowerCase();
        if ("hcaptcha".equals(mode) || "both".equals(mode) || "auto".equals(mode)) {
            if (isHcaptchaConfigured()) return "hcaptcha";
            if ("hcaptcha".equals(mode) || "both".equals(mode)) {
                System.out.println("[hCaptcha] Config incomplete; falling back to math CAPTCHA");
            }
        }
        return "math";
    }

    private boolean isHcaptchaConfigured() {
        return !isBlank(hcaptchaSitekey) && !isBlank(hcaptchaSecret);
    }

    private String urlEncode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }
}
