export interface MobileNetworkProvenanceProperties {
  btsStatus?: string;
  basis?: string[];
  dataQuality?: string;
  metrics?: Record<string, unknown>;
  operatorStatusAvailable?: boolean;
  readModel?: boolean;
  sourceRevision?: string;
}

const basisLabels: Record<string, string> = {
  CTU_NETTEST_MEASUREMENT: "měření ČTÚ NetTest",
  CTU_STATIONARY_MEASUREMENT: "stacionární měření ČTÚ",
  CTU_STATIONARY_MOBILE_MEASUREMENT: "stacionární měření ČTÚ",
  CTU_STATIONARY_SIGNAL_MEASUREMENT: "stacionární měření signálu ČTÚ",
  DISTANCE_PATH_LOSS_MODEL: "výpočet útlumu podle vzdálenosti",
  INFERRED_COVERAGE: "odhad pokrytí",
  NO_OPERATOR_BTS_STATUS: "bez potvrzeného operátorského stavu BTS",
  OSM_INFRASTRUCTURE_HINT: "referenční OSM infrastruktura",
  PRECOMPUTED_COVERAGE_READ_MODEL: "předpočítaná mapa pokrytí"
};

const dataQualityLabels: Record<string, string> = {
  mixed: "kombinovaná data",
  modelled: "modelová data",
  observed: "měřená data",
  unknown: "neznámá kvalita dat"
};

export function isMobileNetworkReadModel(properties: MobileNetworkProvenanceProperties): boolean {
  return properties.readModel === true
    || properties.metrics?.coverageReadModel === true
    || (properties.basis ?? []).includes("PRECOMPUTED_COVERAGE_READ_MODEL");
}

export function mobileNetworkModelLabel(properties: MobileNetworkProvenanceProperties): string {
  if (isMobileNetworkModelEstimate(properties) || properties.dataQuality?.trim().toLowerCase() === "modelled") {
    return "Modelový odhad";
  }
  return isMobileNetworkReadModel(properties) ? "Předpočítané pokrytí" : "Modelový odhad";
}

export function isMobileNetworkModelEstimate(properties: MobileNetworkProvenanceProperties): boolean {
  return properties.operatorStatusAvailable === false
    || properties.btsStatus === "operator_feed_unavailable"
    || (properties.basis ?? []).includes("NO_OPERATOR_BTS_STATUS");
}

export function mobileNetworkOperationalModeLabel(properties: MobileNetworkProvenanceProperties): string {
  return isMobileNetworkModelEstimate(properties)
    ? "modelový odhad bez potvrzeného stavu BTS"
    : "stav s operátorským podkladem";
}

export function mobileNetworkBtsStatusLabel(properties: MobileNetworkProvenanceProperties): string {
  if (properties.btsStatus === "operator_feed_unavailable" || properties.operatorStatusAvailable === false) {
    return "operátorský feed není dostupný";
  }
  if (!properties.btsStatus) {
    return "n/a";
  }
  return humanizeBasisCode(properties.btsStatus);
}

export function mobileNetworkModelExplanation(properties: MobileNetworkProvenanceProperties): string {
  if (isMobileNetworkModelEstimate(properties)) {
    return "Mobilní pokrytí je modelový odhad SIM založený na referenčních BTS/věžích, vzdálenostním modelu a DEM. Stav konkrétní BTS není potvrzen, protože není připojen autorizovaný operátorský/NOC feed.";
  }
  return "Mobilní pokrytí využívá dostupný operátorský stav BTS a modelové hodnoty slouží jako vysvětlující kontext.";
}

export function mobileNetworkDataQualityLabel(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized ? dataQualityLabels[normalized] ?? "jiný datový podklad" : "n/a";
}

export function mobileNetworkBasisLabels(value: string[] | undefined): string {
  if (!value || value.length === 0) {
    return "n/a";
  }
  const labels = Array.from(new Set(value.map((item) => basisLabels[item] ?? humanizeBasisCode(item))));
  return labels.slice(0, 8).join(", ");
}

export function mobileNetworkBtsStatusNotice(value: string[] | undefined): string {
  return value?.includes("NO_OPERATOR_BTS_STATUS")
    ? "Nejde o potvrzený aktuální stav BTS ani výpadek operátora."
    : "n/a";
}

export function formatMobileNetworkSourceRevision(value: string | undefined): string {
  return value?.trim() ? value.trim() : "n/a";
}

function humanizeBasisCode(value: string): string {
  const words = value
    .trim()
    .toLowerCase()
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((word) => {
      const translations: Record<string, string> = {
        bts: "BTS",
        coverage: "pokrytí",
        ctu: "ČTÚ",
        data: "data",
        dem: "výšková data",
        distance: "vzdálenost",
        feed: "feed",
        inferred: "odhad",
        measurement: "měření",
        mobile: "mobilní",
        model: "model",
        no: "bez",
        operator: "operátora",
        osm: "OSM",
        signal: "signál",
        status: "stav",
        terrain: "terén",
        unavailable: "nedostupný"
      };
      return translations[word] ?? word;
    });
  return words.length > 0 ? words.join(" ") : "další datový podklad";
}
