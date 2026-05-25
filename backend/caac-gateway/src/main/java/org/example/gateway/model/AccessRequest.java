package org.example.gateway.model;

/**
 * AccessRequest (Data Transfer Object)
 * This model mirrors the JSON payload expected by the CAAC Oracle. 
 * Field mapping:
 *   rSub -> R_sub  (Role/Clearance Level, e.g. 1=Junior, 5=Admin)
 *   tSub -> T_sub  (Subject Trust Score, historical)
 *   bFreq -> B_freq (Behavioral Frequency ratio)
 *   sLevel -> S_lvl  (Resource Sensitivity Level)
 *   pReq -> P_req  (Minimum required DT_score threshold)
 *   lTrust -> L_trust (Location/IP Trust score)
 *   nStatus -> N_status (Network status score)
 *   dSec -> D_sec  (Device Security score)
 *   tReq -> T_req  (Temporal constraint: true = within allowed hours)
 *   w1,w2,w3 -> Weights for CE_score calculation (sum(w1, w2, w3) = 1.0)
 *   alpha, beta -> Weights for DT_score (sum(alpha, beta) = 1.0)
 *   lambda -> Decay rate for behavioral penalty Φ(B_freq)
 *   tau -> Normal request frequency threshold
 */
public class AccessRequest {

    // Subject Context (C_S)
    private String rSub;
    private String tSub;
    private String bFreq;

    // Resource Context (C_R)
    private String sLevel;
    private String pReq;

    // Environmental Context (C_E)
    private String lTrust;
    private String nStatus;
    private String dSec;
    private String tReq;

    // Weights & Parameters
    private String w1;
    private String w2;
    private String w3;
    private String alpha;
    private String beta;
    private String lambda;
    private String tau;

    public AccessRequest() {}

    public AccessRequest(String rSub, String tSub, String bFreq,
                         String sLevel, String pReq,
                         String lTrust, String nStatus, String dSec, String tReq,
                         String w1, String w2, String w3,
                         String alpha, String beta, String lambda, String tau) {
        this.rSub = rSub;
        this.tSub = tSub;
        this.bFreq = bFreq;
        this.sLevel = sLevel;
        this.pReq = pReq;
        this.lTrust = lTrust;
        this.nStatus = nStatus;
        this.dSec = dSec;
        this.tReq = tReq;
        this.w1 = w1;
        this.w2 = w2;
        this.w3 = w3;
        this.alpha = alpha;
        this.beta = beta;
        this.lambda = lambda;
        this.tau = tau;
    }

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

    public String getLTrust() { return lTrust; }
    public void setLTrust(String lTrust) { this.lTrust = lTrust; }

    public String getNStatus() { return nStatus; }
    public void setNStatus(String nStatus) { this.nStatus = nStatus; }

    public String getDSec() { return dSec; }
    public void setDSec(String dSec) { this.dSec = dSec; }

    public String getTReq() { return tReq; }
    public void setTReq(String tReq) { this.tReq = tReq; }

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
