package org.example.caac;

import org.hyperledger.fabric.contract.Context;
import org.hyperledger.fabric.contract.ContractInterface;
import org.hyperledger.fabric.contract.annotation.Contract;
import org.hyperledger.fabric.contract.annotation.Default;
import org.hyperledger.fabric.contract.annotation.Info;
import org.hyperledger.fabric.contract.annotation.Transaction;

/**
 * CAAC Smart Contract — Algorithm 1
 */
@Contract(
        name = "caac",
        info = @Info(title = "CAAC Contract", description = "Context-Aware Access Control PDP — Improved", version = "2.0.0")
)
@Default
public final class CAACContract implements ContractInterface {

    // Context interaction penalty coefficient
    // It controls how hard a unsafe/tampered device on a secure network is penalized
    // δ or DELTA = 0.3 means up to 30% reduction in CE_score for worst-case interaction
    private static final double DELTA = 0.3;

    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void initLedger(final Context ctx) {
        System.out.println("CAAC Chaincode v2.0.0 Initialized (Improved Algorithm 1)");
    }

    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String evaluateAccess(final Context ctx, final String rSubStr, final String tSubStr, final String bFreqStr,
                                 final String sLevelStr, final String pReqStr, final String lTrustStr, final String nStatusStr,
                                 final String dSecStr, final String tReqStr, final String w1Str, final String w2Str, final String w3Str,
                                 final String alphaStr, final String betaStr, final String lambdaStr, final String tauStr) {
        try {
            int rSub = Math.max(1, Math.min(5, Integer.parseInt(rSubStr)));
            double tSub = clamp01(Double.parseDouble(tSubStr));
            double bFreq = Math.max(0.0, Double.parseDouble(bFreqStr));
            int sLevel = Math.max(1, Math.min(5, Integer.parseInt(sLevelStr)));
            double pReq = clamp01(Double.parseDouble(pReqStr));
            double lTrust = clamp01(Double.parseDouble(lTrustStr));
            double nStatus = clamp01(Double.parseDouble(nStatusStr));
            double dSec = clamp01(Double.parseDouble(dSecStr));
            double w1 = Math.max(0.0, Double.parseDouble(w1Str));
            double w2 = Math.max(0.0, Double.parseDouble(w2Str));
            double w3 = Math.max(0.0, Double.parseDouble(w3Str));
            double alpha = Math.max(0.0, Double.parseDouble(alphaStr));
            double beta = Math.max(0.0, Double.parseDouble(betaStr));
            double lambda = Math.max(0.0, Double.parseDouble(lambdaStr));
            double tau = Math.max(0.0, Double.parseDouble(tauStr));

            double tReq;
            if ("true".equalsIgnoreCase(tReqStr)) {
                tReq = 1.0;
            } else if ("false".equalsIgnoreCase(tReqStr)) {
                tReq = 0.0;
            } else {
                tReq = clamp01(Double.parseDouble(tReqStr));
            }

            if (tReq == 0.0) {
                System.out.println("[Algorithm 1] T_req=0.0 -> immediate DENY");
                return "DENY|0.0|0.0";
            }

            // R_interaction = max(0, (1 - D_sec) × N_status)
            // Needed to penalizes unsafe/tampered devices on trusted networks
            double rInteraction = Math.max(0.0, (1.0 - dSec) * nStatus);

            // Improved: CE_score = [(w1*L + w2*N + w3*D) - δ*R_interaction] * T_req
            double ceBase = (w1 * lTrust) + (w2 * nStatus) + (w3 * dSec);
            double ceScore = Math.max(0.0, ceBase - DELTA * rInteraction) * tReq;
            double phiPenalty = (bFreq <= tau) ? 1.0 : Math.exp(-lambda * (bFreq - tau));
            double dtScore = (alpha * tSub + beta * ceScore) * phiPenalty;

            dtScore = Math.round(dtScore * 10000.0) / 10000.0;
            ceScore = Math.round(ceScore * 10000.0) / 10000.0;
            System.out.println("[Algorithm 1] CE_base=" + round4(ceBase) + " | R_interaction=" + round4(rInteraction)
                    + " | CE_score=" + ceScore + " | T_req=" + round4(tReq));
            System.out.println("[Algorithm 1] Φ(B_freq)=" + round4(phiPenalty) + " | DT_score=" + dtScore + " | P_req=" + pReq);
            String decision = ((rSub >= sLevel) && (dtScore >= pReq)) ? "PERMIT" : "DENY";
            System.out.println("[Algorithm 1] Decision: " + decision + " (R_sub=" + rSub + " >= S_level=" + sLevel + "? " + (rSub >= sLevel) + ")");
            // Return format: "PERMIT|0.7234|0.6500" or "DENY|0.3100|0.2800"
            return decision + "|" + dtScore + "|" + ceScore;
        } catch (Exception e) {
            System.err.println("[Algorithm 1] ERROR: " + e.getMessage());
            return "ERROR|0.0|0.0";
        }
    }

     /**
     * BV-GCA: CAAR - Record a session receipt on-chain
     * Called by the gateway after each session closes
     * Stores an immutable compliance record
     */
    @Transaction(intent = Transaction.TYPE.SUBMIT)
    public void recordSessionReceipt(final Context ctx,
            final String sessionHash, final String userHash, final String fileId,
            final String rgcaTier, final String bytesDeliveredStr,
            final String wasRevokedStr, final String leakageBoundStr,
            final String budgetUsedStr, final String budgetLimitStr,
            final String clusterRiskStr, final String compliantStr) {
        try {
            String key = "receipt_" + sessionHash;
            String existing = ctx.getStub().getStringState(key);
            if (existing != null && !existing.isEmpty()) {
                System.out.println("[CAAR] REJECTED: Receipt already exists for " + key + " (immutable)");
                return;
            }
            String timestamp = ctx.getStub().getTxTimestamp().toString();
            String receipt = "{"
                + "\"sessionHash\":\"" + jsonEscape(sessionHash) + "\","
                + "\"userHash\":\"" + jsonEscape(userHash) + "\","
                + "\"fileId\":\"" + jsonEscape(fileId) + "\","
                + "\"rgcaTier\":\"" + jsonEscape(rgcaTier) + "\","
                + "\"bytesDelivered\":" + bytesDeliveredStr + ","
                + "\"wasRevoked\":" + wasRevokedStr + ","
                + "\"leakageBound\":" + leakageBoundStr + ","
                + "\"budgetUsed\":" + budgetUsedStr + ","
                + "\"budgetLimit\":" + budgetLimitStr + ","
                + "\"clusterRisk\":" + clusterRiskStr + ","
                + "\"compliant\":" + compliantStr + ","
                + "\"timestamp\":\"" + jsonEscape(timestamp) + "\""
                + "}";
            ctx.getStub().putStringState(key, receipt);
            System.out.println("[CAAR] Receipt stored: " + key + " | compliant=" + compliantStr
                + " | bytes=" + bytesDeliveredStr);
        } catch (Exception e) {
            System.err.println("[CAAR] ERROR storing receipt: " + e.getMessage());
        }
    }

    // BV-GCA: Query a receipt by session hash
    @Transaction(intent = Transaction.TYPE.EVALUATE)
    public String getSessionReceipt(final Context ctx, final String sessionHash) {
        String key = "receipt_" + sessionHash;
        String receipt = ctx.getStub().getStringState(key);
        return (receipt != null && !receipt.isEmpty()) ? receipt : "NOT_FOUND";
    }

    private double round4(final double v) {
        return Math.round(v * 10000.0) / 10000.0;
    }

    private double clamp01(final double v) {
        return Math.max(0.0, Math.min(1.0, v));
    }

    private String jsonEscape(final String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
