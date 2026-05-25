package org.example.gateway.model;

/**
 * OracleResult - Parsed response from the CAAC Oracle/Chaincode
 *
 * Algorithm 1 returns: "PERMIT|{dtScore}|{ceScore}" or "DENY|{dtScore}|{ceScore}"
 * This class parses that response into structured fields.
 */
public class OracleResult {

    private final String decision;  // "PERMIT", "DENY", or "ERROR"
    private final double dtScore;
    private final double ceScore;

    public OracleResult(String decision, double dtScore, double ceScore) {
        this.decision = decision;
        this.dtScore = dtScore;
        this.ceScore = ceScore;
    }

    public static OracleResult parse(String response) {
        if (response == null || response.isEmpty()) {
            return new OracleResult("DENY", 0.0, 0.0);
        }

        String trimmed = response.trim();
        String[] parts = trimmed.split("\\|");

        if (parts.length >= 3) {
            // new format: "PERMIT|0.7234|0.6500"
            try {
                return new OracleResult(
                    parts[0].trim(),
                    Double.parseDouble(parts[1].trim()),
                    Double.parseDouble(parts[2].trim())
                );
            } catch (NumberFormatException e) {
                return new OracleResult(parts[0].trim(), 0.0, 0.0);
            }
        } else {
            return new OracleResult(trimmed, 0.0, 0.0);
        }
    }

    public String getDecision() { return decision; }
    public double getDtScore()  { return dtScore; }
    public double getCeScore()  { return ceScore; }

    public boolean isPermit() { return "PERMIT".equals(decision); }
    public boolean isDeny()   { return "DENY".equals(decision); }
    public boolean isError()  { return !isPermit() && !isDeny(); }

    // Risk margin = DT_score - P_req
    public double riskMargin(double pReq) {
        return dtScore - pReq;
    }

    @Override
    public String toString() {
        return decision + " (DT=" + dtScore + ", CE=" + ceScore + ")";
    }
}
