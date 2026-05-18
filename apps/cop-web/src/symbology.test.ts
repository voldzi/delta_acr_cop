import { describe, expect, it } from "vitest";
import { getAffiliationPresentation, getNatoIconKey, resolveCopObjectSymbol } from "./symbology";
import type { CopObject } from "./cop-data";

describe("COP web symbology", () => {
  it("maps own affiliation to blue NATO presentation", () => {
    const presentation = getAffiliationPresentation("FRIEND");

    expect(presentation).toMatchObject({
      disposition: "friend",
      color: "#3b82f6",
      label: "Vlastní"
    });
    expect(getNatoIconKey("AIRCRAFT", "FRIEND")).toBe("nato-friend-aircraft");
  });

  it("maps foreign hostile affiliation to red NATO presentation", () => {
    const presentation = getAffiliationPresentation("HOSTILE");

    expect(presentation).toMatchObject({
      disposition: "hostile",
      color: "#ef4444",
      label: "Cizí"
    });
    expect(getNatoIconKey("UAV", "HOSTILE")).toBe("nato-hostile-uav");
  });

  it("resolves a COP object through the NATO symbol resolver", () => {
    const object: CopObject = {
      objectId: "AIR_SIM_UAV-0001",
      objectType: "UAV",
      affiliation: "HOSTILE",
      domain: "AIR",
      status: "ACTIVE",
      confidence: 0.91,
      synthetic: true
    };

    expect(resolveCopObjectSymbol(object)).toMatchObject({
      symbolSet: "APP6",
      symbolCode: "APP6-AIR-HOSTILE-UAV-ACTIVE",
      fallback: false,
      modifiers: {
        affiliation: "HOSTILE",
        synthetic: true
      }
    });
  });
});
