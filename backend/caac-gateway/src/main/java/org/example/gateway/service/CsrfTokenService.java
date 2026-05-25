package org.example.gateway.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Signed double-submit CSRF tokens for the HttpOnly cookie auth path.
 * The browser can read the CSRF token cookie, but the token is HMAC-bound
 * to the server-side session token so it cannot be reused across sessions.
 */
@Service
public class CsrfTokenService {

    public static final String COOKIE_NAME = "caac_csrf";
    public static final String HEADER_NAME = "X-CAAC-CSRF";

    private final String signingKey;

    public CsrfTokenService(
            @Value("${csrf.hmac.key:}") String csrfKey,
            @Value("${audit.hmac.key:}") String auditKey) {
        String configured = csrfKey != null && !csrfKey.isBlank() ? csrfKey : auditKey;
        this.signingKey = configured != null && !configured.isBlank()
                ? configured
                : SecurityUtils.generateNonce() + SecurityUtils.generateNonce();
    }

    public String issueToken(String authToken) {
        if (authToken == null || authToken.isBlank()) {
            throw new IllegalArgumentException("authToken is required");
        }
        String nonce = SecurityUtils.generateNonce();
        String signature = sign(authToken, nonce);
        return nonce + "." + signature;
    }

    public boolean isValid(String authToken, String csrfToken) {
        if (authToken == null || authToken.isBlank() || csrfToken == null || csrfToken.isBlank()) {
            return false;
        }
        int dot = csrfToken.indexOf('.');
        if (dot <= 0 || dot == csrfToken.length() - 1) {
            return false;
        }
        String nonce = csrfToken.substring(0, dot);
        String signature = csrfToken.substring(dot + 1);
        if (!nonce.matches("[a-f0-9]{32}") || !signature.matches("[a-f0-9]{64}")) {
            return false;
        }
        return SecurityUtils.constantTimeEquals(sign(authToken, nonce), signature);
    }

    private String sign(String authToken, String nonce) {
        String sessionHash = SecurityUtils.sha256(authToken);
        return SecurityUtils.hmacSha256(signingKey, sessionHash + ":" + nonce);
    }
}
