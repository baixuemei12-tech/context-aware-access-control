package org.example.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Externalized BV-GCA / TRT-BL budget constants.
 *
 * Wire via application.properties (or env CAAC_BUDGET_KAPPA, etc.):
 *
 *   caac.budget.kappa=1.0
 *   caac.budget.theta-high=0.500
 *   caac.budget.theta-medium=0.585
 *   caac.budget.theta-low=0.766
 *   caac.budget.mu-high=21.333
 *   caac.budget.mu-medium=19.709
 *   caac.budget.mu-low=4.300
 *   caac.budget.psi-high=0.0
 *   caac.budget.psi-medium=0.6876
 *   caac.budget.psi-low=0.2392
 *   caac.budget.b-max-high-bytes=524288
 *   caac.budget.b-max-medium-bytes=2097152
 *   caac.budget.b-max-low-bytes=4194304
 *
 * Defaults match the original static-final values from FileAccessController.
 * Unused fields left at 0/null fall back to defaults.
 */
@Configuration
@ConfigurationProperties(prefix = "caac.budget")
public class CaacBudgetProperties {

    private double kappa = 1.0;
    private double thetaHigh = 0.500;
    private double thetaMedium = 0.585;
    private double thetaLow = 0.766;
    private double muHigh = 21.333;
    private double muMedium = 19.709;
    private double muLow = 4.300;
    private double psiHigh = 0.0;
    private double psiMedium = 0.6876;
    private double psiLow = 0.2392;
    private long bMaxHighBytes = 512L * 1024;
    private long bMaxMediumBytes = 2L * 1024 * 1024;
    private long bMaxLowBytes = 4L * 1024 * 1024;

    public double getKappa() { return kappa; }
    public void setKappa(double v) { this.kappa = v; }
    public double getThetaHigh() { return thetaHigh; }
    public void setThetaHigh(double v) { this.thetaHigh = v; }
    public double getThetaMedium() { return thetaMedium; }
    public void setThetaMedium(double v) { this.thetaMedium = v; }
    public double getThetaLow() { return thetaLow; }
    public void setThetaLow(double v) { this.thetaLow = v; }
    public double getMuHigh() { return muHigh; }
    public void setMuHigh(double v) { this.muHigh = v; }
    public double getMuMedium() { return muMedium; }
    public void setMuMedium(double v) { this.muMedium = v; }
    public double getMuLow() { return muLow; }
    public void setMuLow(double v) { this.muLow = v; }
    public double getPsiHigh() { return psiHigh; }
    public void setPsiHigh(double v) { this.psiHigh = v; }
    public double getPsiMedium() { return psiMedium; }
    public void setPsiMedium(double v) { this.psiMedium = v; }
    public double getPsiLow() { return psiLow; }
    public void setPsiLow(double v) { this.psiLow = v; }
    public long getBMaxHighBytes() { return bMaxHighBytes; }
    public void setBMaxHighBytes(long v) { this.bMaxHighBytes = v; }
    public long getBMaxMediumBytes() { return bMaxMediumBytes; }
    public void setBMaxMediumBytes(long v) { this.bMaxMediumBytes = v; }
    public long getBMaxLowBytes() { return bMaxLowBytes; }
    public void setBMaxLowBytes(long v) { this.bMaxLowBytes = v; }
}
