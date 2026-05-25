package org.example.gateway.service;

import org.example.gateway.model.AccessRequest;
import org.example.gateway.model.RawContext;
import org.example.gateway.model.User;
import org.springframework.stereotype.Service;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * ContextResolverService
 * Maps raw browser context into mathematical scores for Algorithm 1.
 */
@Service
public class ContextResolverService {

    private static final int WORK_HOUR_START = 8;
    private static final int WORK_HOUR_END   = 22;

    public AccessRequest resolve(RawContext raw, String clientIp, User user) {
        double lTrust  = resolveLocationTrust(clientIp);
        double nStatus = resolveNetworkStatus(raw.getNetworkType());
        double dSec    = resolveDeviceSecurity(
                raw.getUserAgent(), raw.getPlatform(),
                raw.getColorDepth(), raw.getScreenWidth(), raw.getScreenHeight());
        double tReq    = resolveTemporalConstraint(raw.getTimestamp(), raw.getTimezone());

        System.out.println("\n[ContextResolver] === Raw -> Score Mapping ===");
        System.out.println("[ContextResolver] Client IP     : " + clientIp + " -> L_trust  = " + lTrust);
        System.out.println("[ContextResolver] Network Type  : " + raw.getNetworkType() + " -> N_status = " + nStatus);
        System.out.println("[ContextResolver] User-Agent    : " + truncate(raw.getUserAgent(), 50) + " -> D_sec    = " + dSec);
        System.out.println("[ContextResolver] Timestamp     : " + raw.getTimestamp() + " -> T_req    = " + tReq + " (continuous)");
        System.out.println("[ContextResolver] =====================================");
        if (user == null) {
            throw new IllegalArgumentException("Authenticated user is required to resolve subject context");
        }

        AccessRequest request = new AccessRequest();
        request.setRSub(String.valueOf(user.getRSub()));
        request.setTSub(String.valueOf(user.getTSub()));
        request.setBFreq(defaultIfNull(raw.getBFreq(), "1.0"));
        request.setSLevel(defaultIfNull(raw.getSLevel(), "3"));
        request.setPReq(defaultIfNull(raw.getPReq(), "0.5"));
        request.setLTrust(String.valueOf(lTrust));
        request.setNStatus(String.valueOf(nStatus));
        request.setDSec(String.valueOf(dSec));
        request.setTReq(String.valueOf(tReq));
        request.setW1(defaultIfNull(raw.getW1(), "0.33"));
        request.setW2(defaultIfNull(raw.getW2(), "0.33"));
        request.setW3(defaultIfNull(raw.getW3(), "0.34"));
        request.setAlpha(defaultIfNull(raw.getAlpha(), "0.5"));
        request.setBeta(defaultIfNull(raw.getBeta(), "0.5"));
        request.setLambda(defaultIfNull(raw.getLambda(), "0.05"));
        request.setTau(defaultIfNull(raw.getTau(), "100.0"));
        return request;
    }

    public double resolveLocationTrust(String ip) {
        if (ip == null || ip.isEmpty()) return 0.3;
        if ("::1".equals(ip) || "0:0:0:0:0:0:0:1".equals(ip)) return 0.9;
        if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return 0.9;
        if (ip.startsWith("172.")) {
            try {
                int second = Integer.parseInt(ip.split("\\.")[1]);
                if (second >= 16 && second <= 31) return 0.9;
            } catch (NumberFormatException e) { /* fall through */ }
        }
        return 0.5;
    }

    public double resolveNetworkStatus(String networkType) {
        if (networkType == null || networkType.isEmpty()) return 0.6;
        switch (networkType.toLowerCase().trim()) {
            case "ethernet": return 1.0;
            case "wifi": case "4g": return 0.6;
            case "3g": return 0.4;
            case "2g": case "slow-2g": return 0.1;
            default: return 0.5;
        }
    }

    public double resolveDeviceSecurity(String userAgent, String platform, int colorDepth, int screenW, int screenH) {
        return resolveDeviceSecurity(userAgent, platform, colorDepth, screenW, screenH, null);
    }

    /**
     * Resolve device security score with server-side validation.
     *
     * Security improvements (Fix #9):
     * - Detect headless browsers / automation tools (Puppeteer, Selenium, Playwright)
     * - Detect known attack tools (sqlmap, Burp Suite, etc.)
     * - Validate platform/UA consistency (e.g., platform="Win32" but UA contains "Linux" → penalty)
     * - These mitigations reduce the attack surface of client-reported context spoofing.
     */
    public double resolveDeviceSecurity(String userAgent, String platform, int colorDepth, int screenW, int screenH, String rawUserAgent) {
        if (userAgent == null) return 0.3;
        String ua = userAgent.toLowerCase();

        // --- Server-side security checks (cannot be spoofed away) ---

        // 1. Detect headless/automation tools → cap D_sec at 0.5
        if (isHeadlessOrAutomated(ua)) {
            System.out.println("[ContextResolver] WARNING: Headless/automation detected — capping D_sec at 0.5");
            return 0.5;
        }

        // 2. Detect known attack tools → D_sec = 0.1
        if (isAttackTool(ua)) {
            System.out.println("[ContextResolver] WARNING: Attack tool detected — capping D_sec at 0.1");
            return 0.1;
        }

        // 3. Platform/UA consistency check
        // If the client-reported platform doesn't match the UA's OS, apply penalty
        if (platform != null && !platform.isEmpty()) {
            String plat = platform.toLowerCase().trim();
            boolean osMatch = false;
            if (plat.contains("win") && (ua.contains("windows nt"))) osMatch = true;
            else if ((plat.contains("mac") || plat.contains("darwin")) && ua.contains("mac os x")) osMatch = true;
            else if (plat.contains("linux") && ua.contains("linux") && !ua.contains("android")) osMatch = true;
            else if (plat.contains("android") && ua.contains("android")) osMatch = true;
            else if (plat.contains("iphone") || plat.contains("ipad")) {
                if (ua.contains("iphone") || ua.contains("ipad")) osMatch = true;
            }
            // Only flag mismatch if both values are non-trivial
            if (!osMatch && plat.length() > 2 && ua.length() > 10) {
                System.out.println("[ContextResolver] WARNING: Platform/UA mismatch — platform='" + plat + "' vs UA OS penalty applied");
                // Apply a 20% penalty on the final score (computed below)
            }
        }

        // --- Standard scoring (unchanged logic) ---
        double osScore = 0.5;
        if (ua.contains("windows nt 10.0") || ua.contains("windows nt 11.0")) osScore = 0.9;
        else if (ua.contains("windows nt 6.3") || ua.contains("windows nt 6.1")) osScore = 0.4;
        else if (ua.contains("mac os x 10_15") || ua.contains("mac os x 11") || ua.contains("mac os x 12")
                || ua.contains("mac os x 13") || ua.contains("mac os x 14") || ua.contains("mac os x 15")) osScore = 0.9;
        else if (ua.contains("linux") && !ua.contains("android")) osScore = 0.8;
        else if (ua.contains("android")) osScore = 0.7;

        double browserScore = 0.5;
        if (ua.contains("chrome/") || ua.contains("edg/")) browserScore = 0.9;
        else if (ua.contains("firefox/")) browserScore = 0.85;
        else if (ua.contains("safari/") && ua.contains("version/")) browserScore = 0.8;
        else if (ua.contains("msie") || ua.contains("trident/")) browserScore = 0.2;

        double deviceScore = 0.7;
        if (colorDepth >= 24) deviceScore += 0.1;
        else if (colorDepth < 16) deviceScore -= 0.3;
        if (screenW >= 1024 && screenH >= 768) deviceScore += 0.1;
        else if (screenW < 320) deviceScore -= 0.2;
        deviceScore = Math.max(0.0, Math.min(1.0, deviceScore));

        double dSec = 0.4 * osScore + 0.3 * browserScore + 0.3 * deviceScore;

        // Apply platform/UA mismatch penalty (20% reduction)
        if (platform != null && !platform.isEmpty() && !isPlatformUaConsistent(platform, ua)) {
            dSec *= 0.8;
        }

        return Math.round(dSec * 100.0) / 100.0;
    }

    /**
     * Detect headless browser / automation tool fingerprints.
     * These signatures are well-known and cannot be easily masked.
     */
    private boolean isHeadlessOrAutomated(String ua) {
        return ua.contains("headlesschrome")
                || ua.contains("headless") && ua.contains("chrome")
                || ua.contains("puppeteer")
                || ua.contains("selenium")
                || ua.contains("playwright")
                || ua.contains("phantomjs")
                || ua.contains("webdriver")
                || ua.contains("headlessfirefox");
    }

    /**
     * Detect known security testing / attack tools.
     * These should never be used for legitimate access requests.
     */
    private boolean isAttackTool(String ua) {
        return ua.contains("sqlmap")
                || ua.contains("burpsuite")
                || ua.contains("burp") && ua.contains("suite")
                || ua.contains("zap") && ua.contains("proxy")
                || ua.contains("nikto")
                || ua.contains("nmap")
                || ua.contains("masscan")
                || ua.contains("dirbuster")
                || ua.contains("gobuster")
                || ua.contains("wfuzz");
    }

    /**
     * Check if the client-reported platform string is consistent with the UA's OS.
     */
    private boolean isPlatformUaConsistent(String platform, String uaLower) {
        String plat = platform.toLowerCase().trim();
        if (plat.contains("win") && uaLower.contains("windows nt")) return true;
        if ((plat.contains("mac") || plat.contains("darwin") || plat.contains("macintel")) && uaLower.contains("mac os x")) return true;
        if (plat.contains("linux") && uaLower.contains("linux") && !uaLower.contains("android")) return true;
        if (plat.contains("android") && uaLower.contains("android")) return true;
        if ((plat.contains("iphone") || plat.contains("ipad")) && (uaLower.contains("iphone") || uaLower.contains("ipad"))) return true;
        // Allow unknown/empty platform
        if (plat.isEmpty() || plat.equals("unknown")) return true;
        return false;
    }

    // Continuous Temporal Risk Function
    public double resolveTemporalConstraint(String timestamp, String timezone) {
        try {
            LocalTime requestTime;
            if (timezone != null && !timezone.isEmpty()) {
                requestTime = ZonedDateTime.now(ZoneId.of(timezone)).toLocalTime();
            } else if (timestamp != null && !timestamp.isEmpty()) {
                requestTime = LocalDateTime.parse(timestamp, DateTimeFormatter.ISO_DATE_TIME).toLocalTime();
            } else {
                requestTime = LocalTime.now();
            }

            double timeInMinutes = requestTime.getHour() * 60.0 + requestTime.getMinute();
            double startMin = WORK_HOUR_START * 60.0;
            double endMin = WORK_HOUR_END * 60.0;
            if (timeInMinutes >= startMin && timeInMinutes <= endMin) return 1.0;

            double distToStart, distToEnd;
            if (timeInMinutes < startMin) {
                distToStart = startMin - timeInMinutes;
                distToEnd = timeInMinutes + (1440 - endMin);
            } else {
                distToEnd = timeInMinutes - endMin;
                distToStart = (1440 - timeInMinutes) + startMin;
            }

            double minDist = Math.min(distToStart, distToEnd);
            double maxDist = ((1440 - endMin) + startMin) / 2.0; // 300 min
            double ratio = Math.min(minDist / maxDist, 1.0);
            double tReq = Math.cos(Math.PI / 2.0 * ratio);
            tReq = tReq * tReq;
            return Math.round(tReq * 100.0) / 100.0;
        } catch (Exception e) {
            System.err.println("[ContextResolver] Failed to parse time: " + e.getMessage());
            return 1.0;
        }
    }

    // ============================================================
    // C_O — Object Context Risk Assessment
    // ============================================================
    /**
     * Compute the Object Risk score from C_O factors.
     *
     * @param accessCount how many times this file has been accessed
     * @param fileSize file size in bytes
     * @param uploadedAt when the file was uploaded (ISO string)
     * @return O_risk in range [0.0, 1.0]
     */
    public double computeObjectRisk(int accessCount, long fileSize, String uploadedAt) {
        double novelty = 1.0 / (1.0 + 0.1 * accessCount);
        double maxSize = 5.0 * 1024 * 1024; // 5MB
        double sizeFactor = Math.min(1.0, fileSize / maxSize);

        // Age factor
        double ageFactor = 0.5;
        if (uploadedAt != null && !uploadedAt.isEmpty()) {
            try {
                java.time.LocalDateTime uploaded = java.time.LocalDateTime.parse(uploadedAt.substring(0, Math.min(19, uploadedAt.length())));
                long daysSince = java.time.Duration.between(uploaded, java.time.LocalDateTime.now()).toDays();
                ageFactor = Math.exp(-0.1 * daysSince);
            } catch (Exception e) {
                ageFactor = 0.5;
            }
        }

        double oRisk = (0.4 * novelty) + (0.3 * sizeFactor) + (0.3 * ageFactor);
        return Math.max(0.0, Math.min(1.0, oRisk));
    }

    /**
     * Compute the effective threshold P_eff adjusted by Object Risk
     *
     * P_eff = P_req × (1 + η × O_risk)
     * η = 0.2 means max 20% threshold increase for high-risk objects
     *
     * @param pReq the base threshold
     * @param oRisk the object risk score
     * @return adjusted threshold, capped at 1.0
     */
    public double computeEffectiveThreshold(double pReq, double oRisk) {
        double eta = 0.2; // Object risk weight
        double pEff = pReq * (1.0 + eta * oRisk);
        return Math.min(1.0, pEff);
    }

    private String defaultIfNull(String value, String defaultValue) {
        return (value != null && !value.isEmpty()) ? value : defaultValue;
    }

    private String truncate(String s, int maxLen) {
        if (s == null) return "null";
        return s.length() > maxLen ? s.substring(0, maxLen) + "..." : s;
    }
}
