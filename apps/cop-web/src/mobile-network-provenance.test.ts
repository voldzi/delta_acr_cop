import { describe, expect, it } from "vitest";
import {
  isMobileNetworkModelEstimate,
  mobileNetworkBasisLabels,
  mobileNetworkBtsStatusLabel,
  mobileNetworkBtsStatusNotice,
  mobileNetworkDataQualityLabel,
  mobileNetworkModelExplanation,
  mobileNetworkOperationalModeLabel,
  mobileNetworkModelLabel
} from "./mobile-network-provenance";

describe("mobile network provenance", () => {
  it("labels precomputed coverage read models for users", () => {
    expect(mobileNetworkModelLabel({
      basis: ["PRECOMPUTED_COVERAGE_READ_MODEL"],
      readModel: false
    })).toBe("Předpočítané pokrytí");
    expect(mobileNetworkModelLabel({ readModel: false })).toBe("Modelový odhad");
    expect(mobileNetworkModelLabel({
      btsStatus: "operator_feed_unavailable",
      dataQuality: "modelled",
      operatorStatusAvailable: false,
      readModel: true
    })).toBe("Modelový odhad");
  });

  it("translates basis codes without exposing raw provider constants", () => {
    expect(mobileNetworkBasisLabels([
      "PRECOMPUTED_COVERAGE_READ_MODEL",
      "OSM_INFRASTRUCTURE_HINT",
      "NO_OPERATOR_BTS_STATUS",
      "CTU_STATIONARY_SIGNAL_MEASUREMENT"
    ])).toBe("předpočítaná mapa pokrytí, referenční OSM infrastruktura, bez potvrzeného operátorského stavu BTS, stacionární měření signálu ČTÚ");
  });

  it("explains that BTS status is not operator-confirmed", () => {
    expect(mobileNetworkBtsStatusNotice(["NO_OPERATOR_BTS_STATUS"])).toBe("Nejde o potvrzený aktuální stav BTS ani výpadek operátora.");
    expect(mobileNetworkBtsStatusNotice(["INFERRED_COVERAGE"])).toBe("n/a");
  });

  it("treats unavailable operator feed as model estimate, not outage", () => {
    const properties = {
      btsStatus: "operator_feed_unavailable",
      operatorStatusAvailable: false
    };

    expect(isMobileNetworkModelEstimate(properties)).toBe(true);
    expect(mobileNetworkOperationalModeLabel(properties)).toBe("modelový odhad bez potvrzeného stavu BTS");
    expect(mobileNetworkBtsStatusLabel(properties)).toBe("operátorský feed není dostupný");
    expect(mobileNetworkModelExplanation(properties)).toContain("modelový odhad SIM");
  });

  it("labels data quality", () => {
    expect(mobileNetworkDataQualityLabel("mixed")).toBe("kombinovaná data");
    expect(mobileNetworkDataQualityLabel("modelled")).toBe("modelová data");
  });
});
