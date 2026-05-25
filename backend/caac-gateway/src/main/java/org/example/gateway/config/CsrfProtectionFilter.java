package org.example.gateway.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.example.gateway.service.CsrfTokenService;
import org.example.gateway.service.SecurityUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Enforces CSRF on unsafe browser requests that carry the HttpOnly
 * caac_token cookie. Explicit Authorization: Bearer clients without cookies
 * remain usable for CLI/API tooling.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 2)
public class CsrfProtectionFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final CsrfTokenService csrfTokenService;
    private final Set<String> trustedOrigins;

    public CsrfProtectionFilter(
            CsrfTokenService csrfTokenService,
            @Value("${app.cors.allowed-origins:}") String allowedOrigins) {
        this.csrfTokenService = csrfTokenService;
        this.trustedOrigins = Arrays.stream((allowedOrigins == null ? "" : allowedOrigins).split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isUnsafeApiRequest(request)) {
            chain.doFilter(request, response);
            return;
        }

        if (!hasTrustedBrowserOrigin(request)) {
            reject(response, "Untrusted request origin");
            return;
        }

        if (!hasCookie(request, "caac_token") || isCsrfTokenExemptPath(request.getRequestURI())) {
            chain.doFilter(request, response);
            return;
        }

        String authToken = bearerToken(request.getHeader("Authorization"));
        String headerToken = request.getHeader(CsrfTokenService.HEADER_NAME);
        String cookieToken = cookieValue(request, CsrfTokenService.COOKIE_NAME);
        if (authToken == null || headerToken == null || cookieToken == null
                || !SecurityUtils.constantTimeEquals(headerToken, cookieToken)
                || !csrfTokenService.isValid(authToken, headerToken)) {
            reject(response, "Missing or invalid CSRF token");
            return;
        }

        chain.doFilter(request, response);
    }

    private boolean isUnsafeApiRequest(HttpServletRequest request) {
        if (SAFE_METHODS.contains(request.getMethod().toUpperCase(Locale.ROOT))) {
            return false;
        }
        String path = request.getRequestURI();
        return path != null && path.startsWith("/api/");
    }

    private boolean isCsrfTokenExemptPath(String path) {
        return "/api/auth/login".equals(path)
                || "/api/auth/signup".equals(path)
                || "/api/auth/verify-phone".equals(path)
                || "/api/auth/resend-verification".equals(path)
                || "/api/auth/reset-with-code".equals(path);
    }

    private boolean hasTrustedBrowserOrigin(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.isBlank()) {
            return trustedOrigins.contains(origin.trim()) || sameOrigin(request, origin.trim());
        }
        String referer = request.getHeader("Referer");
        if (referer == null || referer.isBlank()) {
            return true;
        }
        try {
            URI uri = URI.create(referer.trim());
            String refOrigin = uri.getScheme() + "://" + uri.getAuthority();
            return trustedOrigins.contains(refOrigin) || sameOrigin(request, refOrigin);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private boolean sameOrigin(HttpServletRequest request, String origin) {
        String scheme = request.getScheme();
        String host = request.getServerName();
        int port = request.getServerPort();
        String self = scheme + "://" + host
                + ((port == 80 && "http".equals(scheme)) || (port == 443 && "https".equals(scheme)) ? "" : ":" + port);
        return self.equals(origin);
    }

    private String bearerToken(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        String token = authHeader.substring("Bearer ".length()).trim();
        return token.isEmpty() ? null : token;
    }

    private String cookieValue(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName()) && cookie.getValue() != null && !cookie.getValue().isBlank()) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private boolean hasCookie(HttpServletRequest request, String name) {
        return cookieValue(request, name) != null;
    }

    private void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"CSRF verification failed\",\"reason\":\"" + message + "\"}");
    }
}
