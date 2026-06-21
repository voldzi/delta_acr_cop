import { describe, expect, it } from "vitest";
import {
  createNatoSymbolSvg,
  getAffiliationPresentation,
  getNatoIconKey,
  getNatoSidc,
  resolveCopObjectSymbol
} from "./symbology";
import type { CopObject } from "./cop-data";

describe("COP web symbology", () => {
  it("maps own affiliation to blue NATO presentation", async () => {
    const presentation = getAffiliationPresentation("FRIEND");
    const assumedFriend = getAffiliationPresentation("ASSUMED_FRIEND");

    expect(presentation).toMatchObject({
      disposition: "friend",
      color: "#3b82f6",
      label: "Vlastní"
    });
    expect(assumedFriend).toMatchObject({
      disposition: "friend",
      color: "#3b82f6",
      label: "Vlastní"
    });
    expect(getNatoIconKey("AIRCRAFT", "FRIEND")).toBe("nato-friend-aircraft");
    expect(getNatoSidc("AIRCRAFT", "FRIEND")).toBe("SFAP-----------");
    await expect(createNatoSymbolSvg("AIRCRAFT", "ASSUMED_FRIEND")).resolves.toContain("#3b82f6");
  });

  it("maps foreign hostile affiliation to red NATO presentation", async () => {
    const presentation = getAffiliationPresentation("HOSTILE");
    const suspect = getAffiliationPresentation("SUSPECT");

    expect(presentation).toMatchObject({
      disposition: "hostile",
      color: "#ef4444",
      label: "Rizikové"
    });
    expect(suspect).toMatchObject({
      disposition: "hostile",
      color: "#ef4444",
      label: "Rizikové"
    });
    expect(getNatoIconKey("UAV", "HOSTILE")).toBe("nato-hostile-uav");
    expect(getNatoSidc("UAV", "HOSTILE")).toBe("SHAPMFQ--------");
    await expect(createNatoSymbolSvg("UAV", "HOSTILE")).resolves.toContain("#ef4444");
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
