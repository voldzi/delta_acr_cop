import { describe, expect, it } from "vitest";
import {
  mobileNetworkBasisLabels,
  mobileNetworkBtsStatusNotice,
  mobileNetworkDataQualityLabel,
  mobileNetworkModelLabel
} from "./mobile-network-provenance";

describe("mobile network provenance", () => {
  it("labels precomputed coverage read models for users", () => {
    expect(mobileNetworkModelLabel({
      basis: ["PRECOMPUTED_COVERAGE_READ_MODEL"],
      readModel: false
    })).toBe("Předpočítané pokrytí");
    expect(mobileNetworkModelLabel({ readModel: false })).toBe("Modelový odhad");
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

  it("labels data quality", () => {
    expect(mobileNetworkDataQualityLabel("mixed")).toBe("kombinovaná data");
    expect(mobileNetworkDataQualityLabel("modelled")).toBe("modelová data");
  });
});
