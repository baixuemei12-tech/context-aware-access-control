package org.example.gateway.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * RawContext (Data Transfer Object)
 *
 * Holds the raw, unprocessed context information collected automatically by the user's browser or mobile app. 
 * This data travels with the access request from the client to the server, where the ContextResolverService maps it to the mathematical scores used by the CAAC algorithms.
 *
 * Raw context fields collected by the browser:
 *   ip -> Client IP address (extracted server-side from request headers)
 *   userAgent -> Full User-Agent string (browser, OS, device info)
 *   timestamp -> ISO 8601 timestamp of the request from the client clock
 *   timezone -> IANA timezone string (e.g. "Asia/Shanghai")
 *   networkType -> Connection type from Navigator.connection API ("wifi", "4g", "3g", "2g", "ethernet", "unknown")
 *   screenWidth/screenHeight -> Screen resolution in pixels
 *   platform -> OS platform string (e.g. "Win32", "Linux x86_64", "MacIntel")
 *   language -> Browser language (e.g. "en-US", "zh-CN")
 *   colorDepth -> Screen color depth in bits (e.g. 24)
 *   touchSupport -> Whether touch input is available (mobile indicator)
 *
 * Subject context fields:
 *   rSub, tSub, bFreq - Subject context (identity, not auto-detected)
 *
 * Resource context fields:
 *   sLevel, pReq - Resource sensitivity and required threshold
 *
 * Weight parameters:
 *   w1, w2, w3, alpha, beta, lambda, tau
 */
public class RawContext {

    // Raw Environmental Context 
    private String userAgent;
    private String timestamp;
    private String timezone;
    private String networkType;
    private int screenWidth;
    private int screenHeight;
    private String platform;
    private String language;
    private int colorDepth;
    private boolean touchSupport;

    // Subject Context
    @JsonProperty("rSub")
    private String rSub;

    @JsonProperty("tSub")
    private String tSub;

    @JsonProperty("bFreq")
    private String bFreq;

    // Resource Context
    @JsonProperty("sLevel")
    private String sLevel;

    @JsonProperty("pReq")
    private String pReq;

    // Weight Parameters (changable)
    private String w1;
    private String w2;
    private String w3;
    private String alpha;
    private String beta;
    private String lambda;
    private String tau;

    public RawContext() {}

    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent; }

    public String getTimestamp() { return timestamp; }
    public void setTimestamp(String timestamp) { this.timestamp = timestamp; }

    public String getTimezone() { return timezone; }
    public void setTimezone(String timezone) { this.timezone = timezone; }

    public String getNetworkType() { return networkType; }
    public void setNetworkType(String networkType) { this.networkType = networkType; }

    public int getScreenWidth() { return screenWidth; }
    public void setScreenWidth(int screenWidth) { this.screenWidth = screenWidth; }

    public int getScreenHeight() { return screenHeight; }
    public void setScreenHeight(int screenHeight) { this.screenHeight = screenHeight; }

    public String getPlatform() { return platform; }
    public void setPlatform(String platform) { this.platform = platform; }

    public String getLanguage() { return language; }
    public void setLanguage(String language) { this.language = language; }

    public int getColorDepth() { return colorDepth; }
    public void setColorDepth(int colorDepth) { this.colorDepth = colorDepth; }

    public boolean isTouchSupport() { return touchSupport; }
    public void setTouchSupport(boolean touchSupport) { this.touchSupport = touchSupport; }

    public String getRSub() { return rSub; }
    public void setRSub(String rSub) { this.rSub = rSub; }

    public String getTSub() { return tSub; }
    public void setTSub(String tSub) { this.tSub = tSub; }

    public String getBFreq() { return bFreq; }
    public void setBFreq(String bFreq) { this.bFreq = bFreq; }

    public String getSLevel() { return sLevel; }
    public void setSLevel(String sLevel) { this.sLevel = sLevel; }

    public String getPReq() { return pReq; }
    public void setPReq(String pReq) { this.pReq = pReq; }

    public String getW1() { return w1; }
    public void setW1(String w1) { this.w1 = w1; }

    public String getW2() { return w2; }
    public void setW2(String w2) { this.w2 = w2; }

    public String getW3() { return w3; }
    public void setW3(String w3) { this.w3 = w3; }

    public String getAlpha() { return alpha; }
    public void setAlpha(String alpha) { this.alpha = alpha; }

    public String getBeta() { return beta; }
    public void setBeta(String beta) { this.beta = beta; }

    public String getLambda() { return lambda; }
    public void setLambda(String lambda) { this.lambda = lambda; }

    public String getTau() { return tau; }
    public void setTau(String tau) { this.tau = tau; }
}
