package org.example.gateway.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;

/**
 * Bridges the additive HttpOnly auth cookie ("caac_token") into the
 * Authorization header so every controller that does
 *     userService.getUserByToken(authHeader)
 * picks it up unchanged. Bearer header continues to work and takes
 * precedence — the cookie is a fallback, so existing fetch() calls in
 * the frontend keep working until they migrate to credentials:'include'.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class CookieAuthBridgeFilter extends OncePerRequestFilter {

    private static final String COOKIE_NAME = "caac_token";
    public static final String AUTH_FROM_COOKIE_ATTR = "caac.auth.fromCookie";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String existing = request.getHeader("Authorization");
        if (existing != null && !existing.isBlank()) {
            chain.doFilter(request, response);
            return;
        }
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            chain.doFilter(request, response);
            return;
        }
        String token = null;
        for (Cookie c : cookies) {
            if (COOKIE_NAME.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank()) {
                token = c.getValue();
                break;
            }
        }
        if (token == null) {
            chain.doFilter(request, response);
            return;
        }
        final String bearer = "Bearer " + token;
        request.setAttribute(AUTH_FROM_COOKIE_ATTR, Boolean.TRUE);
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public String getHeader(String name) {
                if ("Authorization".equalsIgnoreCase(name)) return bearer;
                return super.getHeader(name);
            }
            @Override public Enumeration<String> getHeaders(String name) {
                if ("Authorization".equalsIgnoreCase(name)) {
                    return Collections.enumeration(Collections.singletonList(bearer));
                }
                return super.getHeaders(name);
            }
            @Override public Enumeration<String> getHeaderNames() {
                java.util.List<String> names = new java.util.ArrayList<>();
                Enumeration<String> e = super.getHeaderNames();
                boolean has = false;
                while (e != null && e.hasMoreElements()) {
                    String n = e.nextElement();
                    names.add(n);
                    if ("authorization".equalsIgnoreCase(n)) has = true;
                }
                if (!has) names.add("Authorization");
                return Collections.enumeration(names);
            }
        }, response);
    }
}
