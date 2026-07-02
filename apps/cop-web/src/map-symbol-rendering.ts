import type maplibregl from "maplibre-gl";
import { createNatoSymbolSvg, getNatoIconKey } from "./symbology";
import { transportIconColor, transportIconKinds, type TransportIconKind } from "./transport-presentation";

const mobileNetworkIconPrefix = "cop-mobile-network";
export const mobileNetworkIconTones = ["info", "advisory", "warning", "critical", "unknown", "reference"] as const;
export type MobileNetworkIconTone = (typeof mobileNetworkIconTones)[number];
const civilAircraftIconPrefix = "cop-civil-aircraft";
export const civilAircraftIconKinds = ["jet", "turboprop", "small_aircraft", "helicopter", "glider", "uav", "unknown"] as const;
export type CivilAircraftIconKind = (typeof civilAircraftIconKinds)[number];
const transitIconPrefix = "cop-transit";
const osmCategoryIconPrefix = "cop-osm-category";
export const osmCategoryIconIds = ["airport", "hospital", "fire_station", "police", "pharmacy", "shelter", "townhall", "communications_tower", "other"] as const;
export type OsmCategoryIconId = (typeof osmCategoryIconIds)[number];
const riskIconPrefix = "cop-risk";
export const riskIconIds = ["fire", "flood", "warning", "weather", "unknown"] as const;
export type RiskIconId = (typeof riskIconIds)[number];
const floodTrendIconPrefix = "cop-flood-trend";
export const floodTrendDirections = ["rising", "falling", "stable"] as const;
export type FloodTrendDirection = (typeof floodTrendDirections)[number];
export const floodStageTones = ["ok", "warn", "critical"] as const;
export type FloodStageTone = (typeof floodStageTones)[number];
const weatherConditionIconPrefix = "cop-weather-condition";
export const weatherConditionIconIds = ["sun", "partly_cloudy", "cloud", "fog", "rain", "snow", "storm", "wind", "measurement", "measurement_temperature", "measurement_wind", "measurement_rain", "measurement_humidity", "unknown"] as const;
export type WeatherConditionIconId = (typeof weatherConditionIconIds)[number];
export const weatherWindIconKey = "cop-weather-wind-arrow";
export const weatherCameraIconKey = "cop-weather-camera";

export function getFloodTrendIconKey(direction: FloodTrendDirection, tone: FloodStageTone): string {
  return `${floodTrendIconPrefix}-${direction}-${tone}`;
}

export function getMobileNetworkIconKey(tone: string | undefined): string {
  return `${mobileNetworkIconPrefix}-${normalizeMobileNetworkIconTone(tone)}`;
}

export function getOsmCategoryIconKey(iconId: OsmCategoryIconId): string {
  return `${osmCategoryIconPrefix}-${iconId}`;
}

export function getRiskIconKey(iconId: RiskIconId): string {
  return `${riskIconPrefix}-${iconId}`;
}

export function getWeatherConditionIconKey(iconId: string | undefined): string {
  return `${weatherConditionIconPrefix}-${normalizeWeatherConditionIconId(iconId)}`;
}

function normalizeMobileNetworkIconTone(tone: string | undefined): MobileNetworkIconTone {
  return mobileNetworkIconTones.includes(tone as MobileNetworkIconTone) ? tone as MobileNetworkIconTone : "unknown";
}

function mobileNetworkIconColor(tone: MobileNetworkIconTone): string {
  const colors: Record<MobileNetworkIconTone, string> = {
    advisory: "#fb923c",
    critical: "#ef4444",
    info: "#22c55e",
    reference: "#8cb6d8",
    unknown: "#a78bfa",
    warning: "#facc15"
  };
  return colors[tone];
}

function normalizeCompactAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_\s./-]+/g, "");
}

export function normalizeWeatherConditionIconId(value: string | undefined): WeatherConditionIconId {
  const normalized = normalizeCompactAscii(value ?? "");
  if (["clear", "clearday", "clearnight", "clearsky", "clearskyday", "clearskynight", "sun", "sunny", "jasno"].includes(normalized)) {
    return "sun";
  }
  if ([
    "fair",
    "fairday",
    "fairnight",
    "partlycloudy",
    "partlycloudyday",
    "partlycloudynight",
    "mostlycloudy",
    "polojasno",
    "oblacno"
  ].includes(normalized)) {
    return "partly_cloudy";
  }
  if (["cloud", "cloudy", "overcast", "zatazeno"].includes(normalized)) {
    return "cloud";
  }
  if (["fog", "mist", "mlha"].includes(normalized)) {
    return "fog";
  }
  if ([
    "drizzle",
    "heavyrain",
    "lightrain",
    "precipitation",
    "rain",
    "rainshowers",
    "rainshowersday",
    "rainshowersnight",
    "showers",
    "dest",
    "mrholeni",
    "srazky"
  ].includes(normalized)) {
    return "rain";
  }
  if ([
    "heavysnow",
    "lightsleet",
    "lightsnow",
    "sleet",
    "sleetshowers",
    "snow",
    "snowfall",
    "snowshowers",
    "snowshowersday",
    "snowshowersnight",
    "snezeni",
    "snih"
  ].includes(normalized)) {
    return "snow";
  }
  if ([
    "lightning",
    "rainandthunder",
    "showersandthunder",
    "storm",
    "thunder",
    "thunderstorm",
    "thunderstormwithrain",
    "bourka",
    "bourky"
  ].includes(normalized)) {
    return "storm";
  }
  if (["wind", "windy", "vitr", "veterno"].includes(normalized)) {
    return "wind";
  }
  if (["temperature", "temp", "teplota", "measurementtemperature", "temperaturemeasurement", "thermometer"].includes(normalized)) {
    return "measurement_temperature";
  }
  if (["humidity", "vlhkost", "measurementhumidity", "humiditymeasurement"].includes(normalized)) {
    return "measurement_humidity";
  }
  if (["measurementrain", "rainmeasurement", "precipitationmeasurement", "srazkomer", "srazkymereni"].includes(normalized)) {
    return "measurement_rain";
  }
  if (["measurementwind", "windmeasurement", "windgauge", "anemometer"].includes(normalized)) {
    return "measurement_wind";
  }
  if (["measurement", "measured", "station", "observation", "observed", "mereni", "mericistanice"].includes(normalized)) {
    return "measurement";
  }
  return "unknown";
}

export function getCivilAircraftIconKey(kind: CivilAircraftIconKind): string {
  return `${civilAircraftIconPrefix}-${kind}`;
}

export function getTransitIconKey(kind: TransportIconKind): string {
  return `${transitIconPrefix}-${kind}`;
}

export async function registerNatoSymbolImages(map: maplibregl.Map) {
  const objectTypes = ["AIRCRAFT", "UAV", "MISSILE_TRACK", "GROUND_UNIT", "RESCUE_ASSET", "INCIDENT", "REPORT", "UNKNOWN"];
  const affiliations = ["FRIEND", "ASSUMED_FRIEND", "HOSTILE", "SUSPECT", "NEUTRAL", "UNKNOWN", "PENDING"];

  const registrations = new Map<string, { objectType: string; affiliation: string }>();
  objectTypes.forEach((objectType) => {
    affiliations.forEach((affiliation) => {
      registrations.set(getNatoIconKey(objectType, affiliation), { objectType, affiliation });
    });
  });

  await Promise.all(
    Array.from(registrations.entries()).map(async ([key, registration]) => {
      if (!map.hasImage(key)) {
        map.addImage(key, await createNatoSymbolImage(registration.objectType, registration.affiliation), {
          pixelRatio: window.devicePixelRatio || 1
        });
      }
    })
  );
}

export async function registerCivilAircraftSymbolImages(map: maplibregl.Map) {
  civilAircraftIconKinds.forEach((kind) => {
    const key = getCivilAircraftIconKey(kind);
    if (!map.hasImage(key)) {
      map.addImage(key, createCivilAircraftSymbolImage(kind), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
}

export async function registerSituationSymbolImages(map: maplibregl.Map) {
  mobileNetworkIconTones.forEach((tone) => {
    const key = getMobileNetworkIconKey(tone);
    if (!map.hasImage(key)) {
      map.addImage(key, createMobileNetworkSymbolImage(tone), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  transportIconKinds.forEach((kind) => {
    const key = getTransitIconKey(kind);
    if (!map.hasImage(key)) {
      map.addImage(key, createTransitSymbolImage(kind), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  osmCategoryIconIds.forEach((iconId) => {
    const key = getOsmCategoryIconKey(iconId);
    if (!map.hasImage(key)) {
      map.addImage(key, createOsmCategorySymbolImage(iconId), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  riskIconIds.forEach((iconId) => {
    const key = getRiskIconKey(iconId);
    if (!map.hasImage(key)) {
      map.addImage(key, createRiskSymbolImage(iconId), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  floodTrendDirections.forEach((direction) => {
    floodStageTones.forEach((tone) => {
      const key = getFloodTrendIconKey(direction, tone);
      if (!map.hasImage(key)) {
        map.addImage(key, createFloodTrendSymbolImage(direction, tone), {
          pixelRatio: window.devicePixelRatio || 1
        });
      }
    });
  });
  weatherConditionIconIds.forEach((iconId) => {
    const key = getWeatherConditionIconKey(iconId);
    if (!map.hasImage(key)) {
      map.addImage(key, createWeatherConditionSymbolImage(iconId), {
        pixelRatio: window.devicePixelRatio || 1
      });
    }
  });
  if (!map.hasImage(weatherWindIconKey)) {
    map.addImage(weatherWindIconKey, createWeatherWindArrowImage(), {
      pixelRatio: window.devicePixelRatio || 1
    });
  }
  if (!map.hasImage(weatherCameraIconKey)) {
    map.addImage(weatherCameraIconKey, createWeatherCameraSymbolImage(), {
      pixelRatio: window.devicePixelRatio || 1
    });
  }
}

export function createCivilAircraftSymbolImage(kind: CivilAircraftIconKind): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(64, 64);
  context.lineCap = "round";
  context.lineJoin = "round";
  drawCivilAircraftShape(context, kind, "rgba(6, 16, 25, 0.92)", 10);
  drawCivilAircraftShape(context, kind, "rgba(248, 250, 252, 0.95)", 6);
  drawCivilAircraftShape(context, kind, "#facc15", 3.2);
  context.restore();

  return context.getImageData(0, 0, size, size);
}

function drawCivilAircraftShape(context: CanvasRenderingContext2D, kind: CivilAircraftIconKind, strokeStyle: string, lineWidth: number): void {
  context.save();
  context.strokeStyle = strokeStyle;
  context.fillStyle = strokeStyle;
  context.lineWidth = lineWidth;

  if (kind === "helicopter") {
    context.beginPath();
    context.moveTo(-34, -28);
    context.lineTo(34, -28);
    context.moveTo(0, -28);
    context.lineTo(0, -12);
    context.stroke();
    drawRoundedRect(context, -18, -12, 36, 28, 10);
    context.stroke();
    context.beginPath();
    context.moveTo(18, 0);
    context.lineTo(42, 16);
    context.lineTo(54, 16);
    context.moveTo(-14, 17);
    context.lineTo(14, 17);
    context.stroke();
    context.restore();
    return;
  }

  if (kind === "uav") {
    context.beginPath();
    context.moveTo(0, -40);
    context.lineTo(32, 24);
    context.lineTo(0, 10);
    context.lineTo(-32, 24);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.arc(0, 0, 5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  if (kind === "glider") {
    context.beginPath();
    context.moveTo(0, -42);
    context.lineTo(0, 34);
    context.moveTo(-48, -8);
    context.quadraticCurveTo(0, -20, 48, -8);
    context.moveTo(-14, 25);
    context.lineTo(14, 25);
    context.stroke();
    context.restore();
    return;
  }

  const wingSpan = kind === "small_aircraft" ? 34 : kind === "turboprop" ? 42 : 48;
  const tailSpan = kind === "small_aircraft" ? 18 : 24;
  context.beginPath();
  context.moveTo(0, -48);
  context.lineTo(0, 44);
  context.moveTo(-wingSpan, -8);
  context.lineTo(wingSpan, -8);
  context.moveTo(-tailSpan, 29);
  context.lineTo(tailSpan, 29);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -55);
  context.lineTo(9, -39);
  context.lineTo(-9, -39);
  context.closePath();
  context.fill();
  if (kind === "turboprop") {
    [-28, 28].forEach((x) => {
      context.beginPath();
      context.arc(x, -9, 5, 0, Math.PI * 2);
      context.fill();
    });
  }
  context.restore();
}

async function createNatoSymbolImage(objectType: string, affiliation: string): Promise<ImageData> {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  const image = await loadSvgImage(await createNatoSymbolSvg(objectType, affiliation));
  const scale = Math.min(82 / image.width, 82 / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

  return context.getImageData(0, 0, size, size);
}

export function createMobileNetworkSymbolImage(tone: MobileNetworkIconTone): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const waveColor = mobileNetworkIconColor(tone);
  const centerX = 64;
  const antennaY = 50;
  const baseY = 124;
  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";
  drawPictogramPlate(context, {
    accentColor: waveColor,
    centerX,
    centerY: 59,
    height: 82,
    radius: 25,
    width: 88
  });

  const drawWaves = (strokeStyle: string, lineWidth: number, alpha = 1) => {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    [24, 38, 52].forEach((radius) => {
      context.beginPath();
      context.arc(centerX, antennaY, radius, -0.86, 0.86);
      context.stroke();
      context.beginPath();
      context.arc(centerX, antennaY, radius, Math.PI - 0.86, Math.PI + 0.86);
      context.stroke();
    });
    context.restore();
  };

  const drawTower = (strokeStyle: string, lineWidth: number, alpha = 1) => {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(centerX, antennaY);
    context.lineTo(34, baseY);
    context.moveTo(centerX, antennaY);
    context.lineTo(94, baseY);
    context.moveTo(centerX, antennaY);
    context.lineTo(centerX, baseY);
    context.moveTo(38, baseY);
    context.lineTo(90, baseY);
    context.moveTo(49, 80);
    context.lineTo(79, 96);
    context.moveTo(79, 80);
    context.lineTo(49, 96);
    context.moveTo(45, 108);
    context.lineTo(83, 108);
    context.moveTo(57, 64);
    context.lineTo(71, 64);
    context.stroke();
    context.fillStyle = strokeStyle;
    context.beginPath();
    context.arc(centerX, antennaY, lineWidth >= 8 ? 9 : 5, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  drawWaves("rgba(248, 250, 252, 0.92)", 13, 0.9);
  drawWaves(waveColor, 7, 0.96);
  drawTower("rgba(248, 250, 252, 0.96)", 10, 0.95);
  drawTower("#061019", 5, 0.96);

  return context.getImageData(0, 0, size, size);
}

export function createTransitSymbolImage(kind: TransportIconKind): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const color = transportIconColor(kind);
  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";

  context.save();
  drawRoundedRect(context, 18, 18, 92, 92, kind === "metro" ? 46 : 20);
  context.fillStyle = "rgba(6, 16, 25, 0.95)";
  context.fill();
  context.strokeStyle = "rgba(248, 250, 252, 0.92)";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 5;
  context.stroke();
  context.restore();

  context.save();
  context.translate(64, 64);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 7;

  switch (kind) {
    case "bus":
    case "trolleybus":
      drawRoundedRect(context, -31, -26, 62, 54, 9);
      context.stroke();
      context.beginPath();
      context.moveTo(-20, -8);
      context.lineTo(20, -8);
      context.moveTo(-20, 9);
      context.lineTo(20, 9);
      context.stroke();
      context.beginPath();
      context.arc(-20, 31, 5, 0, Math.PI * 2);
      context.arc(20, 31, 5, 0, Math.PI * 2);
      context.fill();
      if (kind === "trolleybus") {
        context.beginPath();
        context.moveTo(-12, -30);
        context.lineTo(-29, -43);
        context.moveTo(12, -30);
        context.lineTo(29, -43);
        context.stroke();
      }
      break;
    case "tram":
      drawRoundedRect(context, -27, -34, 54, 62, 10);
      context.stroke();
      context.beginPath();
      context.moveTo(-14, -11);
      context.lineTo(14, -11);
      context.moveTo(-16, 8);
      context.lineTo(16, 8);
      context.moveTo(-22, 34);
      context.lineTo(22, 34);
      context.moveTo(-16, -36);
      context.lineTo(0, -51);
      context.lineTo(16, -36);
      context.stroke();
      break;
    case "train":
      drawRoundedRect(context, -29, -35, 58, 64, 13);
      context.stroke();
      context.beginPath();
      context.moveTo(-16, -11);
      context.lineTo(16, -11);
      context.moveTo(-14, 9);
      context.lineTo(14, 9);
      context.moveTo(-22, 37);
      context.lineTo(-8, 24);
      context.moveTo(22, 37);
      context.lineTo(8, 24);
      context.stroke();
      break;
    case "metro":
      context.font = "700 48px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("M", 0, 3);
      break;
    case "ferry":
      context.beginPath();
      context.moveTo(-35, 10);
      context.lineTo(35, 10);
      context.lineTo(21, 30);
      context.lineTo(-21, 30);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(-17, 9);
      context.lineTo(-6, -18);
      context.lineTo(17, 9);
      context.stroke();
      break;
    case "funicular":
      drawRoundedRect(context, -27, -25, 54, 44, 9);
      context.stroke();
      context.beginPath();
      context.moveTo(-35, 34);
      context.lineTo(35, -36);
      context.stroke();
      break;
    case "stop":
      context.beginPath();
      context.arc(0, -4, 21, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(0, -4, 8, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.moveTo(0, 18);
      context.lineTo(0, 42);
      context.moveTo(-17, 42);
      context.lineTo(17, 42);
      context.stroke();
      break;
    case "road_event":
      context.beginPath();
      context.moveTo(0, -32);
      context.lineTo(31, 25);
      context.lineTo(-31, 25);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.moveTo(0, -12);
      context.lineTo(0, 8);
      context.stroke();
      context.beginPath();
      context.arc(0, 19, 4, 0, Math.PI * 2);
      context.fill();
      break;
    case "traffic":
    case "unknown":
      context.beginPath();
      context.arc(0, 0, 24, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.arc(0, 0, 9, 0, Math.PI * 2);
      context.fill();
      break;
  }
  context.restore();

  return context.getImageData(0, 0, size, size);
}

export function createWeatherConditionSymbolImage(iconId: WeatherConditionIconId): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const drawSun = (x: number, y: number, radius: number) => {
    context.save();
    context.strokeStyle = "#061019";
    context.fillStyle = "#facc15";
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI * 2 * i) / 8;
      context.beginPath();
      context.moveTo(x + Math.cos(angle) * (radius + 8), y + Math.sin(angle) * (radius + 8));
      context.lineTo(x + Math.cos(angle) * (radius + 18), y + Math.sin(angle) * (radius + 18));
      context.stroke();
    }
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  };

  const drawCloud = (x: number, y: number, scale = 1) => {
    context.save();
    context.translate(x, y);
    context.scale(scale, scale);
    context.fillStyle = "rgba(248, 250, 252, 0.98)";
    context.strokeStyle = "#061019";
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(-40, 17);
    context.quadraticCurveTo(-48, 4, -35, -7);
    context.quadraticCurveTo(-25, -28, -4, -17);
    context.quadraticCurveTo(9, -39, 32, -24);
    context.quadraticCurveTo(53, -20, 54, 3);
    context.quadraticCurveTo(56, 18, 39, 21);
    context.lineTo(-31, 21);
    context.quadraticCurveTo(-37, 21, -40, 17);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(219, 234, 254, 0.9)";
    context.fillRect(-32, 18, 69, 7);
    context.restore();
  };

  const drawDrops = (snow = false) => {
    const positions = [-26, 0, 26];
    positions.forEach((x, index) => {
      const y = 34 + (index % 2) * 8;
      context.save();
      context.translate(x, y);
      context.strokeStyle = "#061019";
      context.lineWidth = snow ? 3.5 : 4.5;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (snow) {
        context.strokeStyle = "#061019";
        for (let i = 0; i < 3; i += 1) {
          context.rotate(Math.PI / 3);
          context.beginPath();
          context.moveTo(-7, 0);
          context.lineTo(7, 0);
          context.stroke();
        }
        context.strokeStyle = "#e0f2fe";
        context.lineWidth = 2;
        for (let i = 0; i < 3; i += 1) {
          context.rotate(Math.PI / 3);
          context.beginPath();
          context.moveTo(-7, 0);
          context.lineTo(7, 0);
          context.stroke();
        }
      } else {
        context.fillStyle = "#38bdf8";
        context.beginPath();
        context.moveTo(0, -12);
        context.bezierCurveTo(11, 0, 8, 15, 0, 16);
        context.bezierCurveTo(-8, 15, -11, 0, 0, -12);
        context.closePath();
        context.fill();
        context.stroke();
      }
      context.restore();
    });
  };

  const drawLightning = () => {
    context.save();
    context.fillStyle = "#facc15";
    context.strokeStyle = "#061019";
    context.lineWidth = 5;
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(10, -1);
    context.lineTo(-5, 33);
    context.lineTo(10, 30);
    context.lineTo(-1, 60);
    context.lineTo(29, 18);
    context.lineTo(13, 22);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  };

  const drawFog = () => {
    context.save();
    context.strokeStyle = "#061019";
    context.lineWidth = 4.8;
    context.lineCap = "round";
    [-8, 10, 28].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-38 + index * 3, y);
      context.bezierCurveTo(-17, y - 7, 12, y + 7, 38, y);
      context.stroke();
    });
    context.strokeStyle = "rgba(226, 246, 255, 0.98)";
    context.lineWidth = 2.6;
    [-8, 10, 28].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-38 + index * 3, y);
      context.bezierCurveTo(-17, y - 7, 12, y + 7, 38, y);
      context.stroke();
    });
    context.restore();
  };

  const drawWindSymbol = () => {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#061019";
    context.lineWidth = 7;
    [-20, 2, 24].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-42, y);
      context.bezierCurveTo(-16, y - 12, 12, y + 10, 40, y - 2);
      if (index === 0) {
        context.bezierCurveTo(53, y - 8, 53, y + 13, 35, y + 11);
      }
      context.stroke();
    });
    context.strokeStyle = "rgba(226, 246, 255, 0.98)";
    context.lineWidth = 3.8;
    [-20, 2, 24].forEach((y, index) => {
      context.beginPath();
      context.moveTo(-42, y);
      context.bezierCurveTo(-16, y - 12, 12, y + 10, 40, y - 2);
      if (index === 0) {
        context.bezierCurveTo(53, y - 8, 53, y + 13, 35, y + 11);
      }
      context.stroke();
    });
    context.restore();
  };

  const drawThermometer = (stroke = "#061019", fill = "#ef4444") => {
    context.save();
    context.strokeStyle = stroke;
    context.fillStyle = fill;
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.arc(-4, 17, 13, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-4, 7);
    context.lineTo(-4, -29);
    context.quadraticCurveTo(-4, -38, 5, -38);
    context.quadraticCurveTo(14, -38, 14, -29);
    context.lineTo(14, 14);
    context.stroke();
    context.beginPath();
    context.moveTo(24, -24);
    context.lineTo(38, -24);
    context.moveTo(24, -9);
    context.lineTo(35, -9);
    context.moveTo(24, 6);
    context.lineTo(38, 6);
    context.stroke();
    context.restore();
  };

  const drawHumidityDrop = () => {
    context.save();
    context.strokeStyle = "#061019";
    context.fillStyle = "#38bdf8";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(-6, -35);
    context.bezierCurveTo(26, -2, 22, 35, -6, 37);
    context.bezierCurveTo(-34, 35, -38, -2, -6, -35);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = "#061019";
    context.font = "800 24px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("%", 14, 2);
    context.restore();
  };

  const drawRainGauge = () => {
    context.save();
    context.strokeStyle = "#061019";
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    drawDrops(false);
    context.beginPath();
    context.roundRect?.(-30, 3, 60, 36, 10);
    if (!context.roundRect) {
      drawRoundedRect(context, -30, 3, 60, 36, 10);
    }
    context.fillStyle = "rgba(224, 242, 254, 0.96)";
    context.fill();
    context.stroke();
    context.strokeStyle = "#0ea5e9";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(-18, 24);
    context.lineTo(18, 24);
    context.moveTo(-18, 13);
    context.lineTo(18, 13);
    context.stroke();
    context.restore();
  };

  const drawMeasuredWind = () => {
    drawWindSymbol();
    context.save();
    context.strokeStyle = "#061019";
    context.fillStyle = "#a7f3d0";
    context.lineWidth = 4;
    context.beginPath();
    context.arc(-30, 30, 11, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-30, 19);
    context.lineTo(-30, 45);
    context.moveTo(-42, 45);
    context.lineTo(-18, 45);
    context.stroke();
    context.restore();
  };

  const drawMeasurementStation = (kind: WeatherConditionIconId = "measurement") => {
    context.save();
    if (kind === "measurement_humidity") {
      drawHumidityDrop();
    } else if (kind === "measurement_rain") {
      drawRainGauge();
    } else if (kind === "measurement_wind") {
      drawMeasuredWind();
    } else {
      drawThermometer("#061019", kind === "measurement_temperature" ? "#fb923c" : "#22c55e");
    }
    context.restore();
  };

  context.clearRect(0, 0, size, size);
  drawPictogramPlate(context, {
    accentColor: weatherConditionAccentColor(iconId),
    centerX: 64,
    centerY: 58,
    height: 80,
    radius: 26,
    width: 88
  });
  context.save();
  context.translate(64, 54);
  context.scale(0.82, 0.82);
  context.shadowBlur = 4;
  context.shadowColor = "rgba(6, 16, 25, 0.16)";

  switch (iconId) {
    case "sun":
      drawSun(0, 2, 25);
      break;
    case "partly_cloudy":
      drawSun(25, -21, 18);
      drawCloud(-2, 5, 0.94);
      break;
    case "cloud":
      drawCloud(0, 2, 1);
      break;
    case "fog":
      drawCloud(0, -11, 0.86);
      drawFog();
      break;
    case "rain":
      drawCloud(0, -7, 0.92);
      drawDrops(false);
      break;
    case "snow":
      drawCloud(0, -8, 0.92);
      drawDrops(true);
      break;
    case "storm":
      drawCloud(0, -8, 0.9);
      drawLightning();
      break;
    case "wind":
      drawWindSymbol();
      break;
    case "measurement":
    case "measurement_temperature":
    case "measurement_wind":
    case "measurement_rain":
    case "measurement_humidity":
      drawMeasurementStation(iconId);
      break;
    case "unknown":
      drawMeasurementStation();
      break;
  }
  context.restore();

  return context.getImageData(0, 0, size, size);
}

function drawPictogramPlate(
  context: CanvasRenderingContext2D,
  options: {
    accentColor: string;
    centerX: number;
    centerY: number;
    height: number;
    radius: number;
    width: number;
  }
): void {
  const { accentColor, centerX, centerY, height, radius, width } = options;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  const bottom = top + height;

  context.save();
  context.shadowColor = "rgba(6, 16, 25, 0.34)";
  context.shadowBlur = 14;
  context.shadowOffsetY = 8;
  context.fillStyle = "rgba(6, 16, 25, 0.18)";
  context.beginPath();
  context.ellipse(centerX, bottom + 15, width * 0.31, 7, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.shadowColor = "rgba(6, 16, 25, 0.28)";
  context.shadowBlur = 10;
  context.shadowOffsetY = 5;
  const gradient = context.createLinearGradient(left, top, left, bottom + 18);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.99)");
  gradient.addColorStop(0.62, "rgba(238, 246, 255, 0.98)");
  gradient.addColorStop(1, "rgba(213, 229, 243, 0.98)");
  context.fillStyle = gradient;
  drawRoundedRect(context, left, top, width, height, radius);
  context.fill();

  context.beginPath();
  context.moveTo(centerX - 13, bottom - 4);
  context.quadraticCurveTo(centerX, bottom + 21, centerX + 13, bottom - 4);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.lineWidth = 4.5;
  context.strokeStyle = "rgba(6, 16, 25, 0.82)";
  drawRoundedRect(context, left, top, width, height, radius);
  context.stroke();
  context.beginPath();
  context.moveTo(centerX - 13, bottom - 4);
  context.quadraticCurveTo(centerX, bottom + 21, centerX + 13, bottom - 4);
  context.stroke();

  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.lineWidth = 2.2;
  drawRoundedRect(context, left + 3, top + 3, width - 6, height - 6, Math.max(8, radius - 4));
  context.stroke();

  context.fillStyle = accentColor;
  drawRoundedRect(context, centerX - 22, top + 8, 44, 6, 3);
  context.fill();

  context.beginPath();
  context.arc(centerX, bottom + 22, 4.4, 0, Math.PI * 2);
  context.fillStyle = accentColor;
  context.fill();
  context.lineWidth = 2.2;
  context.strokeStyle = "rgba(255, 255, 255, 0.92)";
  context.stroke();
  context.restore();
}

function weatherConditionAccentColor(iconId: WeatherConditionIconId): string {
  switch (iconId) {
    case "sun":
    case "partly_cloudy":
      return "#facc15";
    case "rain":
    case "measurement_rain":
      return "#38bdf8";
    case "snow":
      return "#bfdbfe";
    case "storm":
      return "#f59e0b";
    case "wind":
    case "measurement_wind":
      return "#67e8f9";
    case "fog":
    case "cloud":
      return "#94a3b8";
    case "measurement_temperature":
      return "#fb923c";
    case "measurement_humidity":
      return "#0ea5e9";
    case "measurement":
      return "#22c55e";
    case "unknown":
      return "#a78bfa";
  }
}

export function createWeatherWindArrowImage(): ImageData {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(48, 48);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(6, 16, 25, 0.92)";
  context.lineWidth = 11;
  context.beginPath();
  context.moveTo(0, 34);
  context.lineTo(0, -28);
  context.moveTo(0, -28);
  context.lineTo(-17, -9);
  context.moveTo(0, -28);
  context.lineTo(17, -9);
  context.stroke();
  context.strokeStyle = "rgba(226, 246, 255, 0.92)";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(0, 34);
  context.lineTo(0, -28);
  context.moveTo(0, -28);
  context.lineTo(-17, -9);
  context.moveTo(0, -28);
  context.lineTo(17, -9);
  context.stroke();
  context.restore();

  return context.getImageData(0, 0, size, size);
}

export function createWeatherCameraSymbolImage(): ImageData {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";

  context.save();
  context.translate(64, 60);
  context.shadowBlur = 14;
  context.shadowColor = "rgba(6, 16, 25, 0.42)";
  context.fillStyle = "rgba(6, 16, 25, 0.24)";
  context.beginPath();
  context.ellipse(0, 54, 24, 8, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.translate(64, 52);
  context.shadowBlur = 12;
  context.shadowColor = "rgba(6, 16, 25, 0.48)";

  context.beginPath();
  context.arc(0, 0, 36, 0, Math.PI * 2);
  context.fillStyle = "rgba(248, 250, 252, 0.98)";
  context.fill();
  context.lineWidth = 5.5;
  context.strokeStyle = "rgba(6, 16, 25, 0.9)";
  context.stroke();

  context.beginPath();
  context.moveTo(-12, 31);
  context.quadraticCurveTo(0, 52, 12, 31);
  context.lineTo(-12, 31);
  context.closePath();
  context.fillStyle = "rgba(248, 250, 252, 0.98)";
  context.fill();
  context.stroke();

  const gradient = context.createLinearGradient(-24, -18, 28, 26);
  gradient.addColorStop(0, "#67e8f9");
  gradient.addColorStop(1, "#0ea5e9");
  context.fillStyle = gradient;
  context.strokeStyle = "#0369a1";
  context.lineWidth = 3.4;
  drawRoundedRect(context, -23, -10, 46, 34, 8);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(-13, -10);
  context.lineTo(-8, -20);
  context.lineTo(9, -20);
  context.lineTo(15, -10);
  context.closePath();
  context.fill();
  context.stroke();

  context.beginPath();
  context.arc(0, 7, 11.5, 0, Math.PI * 2);
  context.fillStyle = "#e0f2fe";
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = "#075985";
  context.stroke();
  context.beginPath();
  context.arc(0, 7, 4.6, 0, Math.PI * 2);
  context.fillStyle = "#075985";
  context.fill();

  context.beginPath();
  context.arc(17, -2, 3, 0, Math.PI * 2);
  context.fillStyle = "#f8fafc";
  context.fill();

  context.restore();

  context.save();
  context.translate(64, 117);
  context.beginPath();
  context.arc(0, 0, 4.4, 0, Math.PI * 2);
  context.fillStyle = "#38bdf8";
  context.fill();
  context.lineWidth = 2.4;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.restore();

  return context.getImageData(0, 0, size, size);
}

export function createFloodTrendSymbolImage(direction: FloodTrendDirection, tone: FloodStageTone): ImageData {
  const canvas = document.createElement("canvas");
  const size = 92;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const color = floodStageToneColor(tone);
  context.clearRect(0, 0, size, size);
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.46)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 3;
  context.fillStyle = color;
  context.beginPath();
  context.arc(46, 46, 35, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.strokeStyle = "rgba(248, 250, 252, 0.98)";
  context.lineWidth = 7;
  context.beginPath();
  context.arc(46, 46, 35, 0, Math.PI * 2);
  context.stroke();
  context.restore();

  context.save();
  context.translate(46, 46);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#061019";
  context.fillStyle = "#061019";
  context.lineWidth = 9;
  if (direction === "stable") {
    context.beginPath();
    context.arc(0, 0, 11, 0, Math.PI * 2);
    context.fill();
  } else {
    const sign = direction === "rising" ? -1 : 1;
    context.beginPath();
    context.moveTo(0, 23 * sign);
    context.lineTo(0, -23 * sign);
    context.stroke();
    context.beginPath();
    context.moveTo(0, -26 * sign);
    context.lineTo(-15, -9 * sign);
    context.lineTo(15, -9 * sign);
    context.closePath();
    context.fill();
  }
  context.restore();

  return context.getImageData(0, 0, size, size);
}

function floodStageToneColor(tone: FloodStageTone): string {
  switch (tone) {
    case "critical":
      return "#ef4444";
    case "warn":
      return "#facc15";
    case "ok":
      return "#22c55e";
  }
}

export function createRiskSymbolImage(iconId: RiskIconId): ImageData {
  const canvas = document.createElement("canvas");
  const size = 112;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#061019";
  context.fillStyle = "#f8fafc";
  context.lineWidth = 10;
  drawPictogramPlate(context, {
    accentColor: riskIconAccentColor(iconId),
    centerX: 56,
    centerY: 54,
    height: 74,
    radius: 24,
    width: 80
  });

  const strokePath = (draw: () => void) => {
    context.save();
    context.strokeStyle = "rgba(6, 16, 25, 0.95)";
    context.lineWidth = 13;
    draw();
    context.stroke();
    context.restore();
    context.save();
    context.strokeStyle = "rgba(248, 250, 252, 0.96)";
    context.lineWidth = 7;
    draw();
    context.stroke();
    context.restore();
  };

  switch (iconId) {
    case "fire":
      context.save();
      context.translate(56, 56);
      context.beginPath();
      context.moveTo(0, -39);
      context.bezierCurveTo(22, -13, 18, 5, 7, 17);
      context.bezierCurveTo(19, 4, 4, -11, 3, -24);
      context.bezierCurveTo(-13, -9, -24, 5, -20, 22);
      context.bezierCurveTo(-16, 43, 18, 43, 27, 16);
      context.bezierCurveTo(31, 35, 13, 51, -9, 45);
      context.bezierCurveTo(-38, 38, -43, 6, -17, -20);
      context.bezierCurveTo(-7, -30, -4, -35, 0, -39);
      context.closePath();
      context.fillStyle = "rgba(6, 16, 25, 0.95)";
      context.fill();
      context.lineWidth = 5;
      context.strokeStyle = "rgba(248, 250, 252, 0.96)";
      context.stroke();
      context.restore();
      break;
    case "flood":
      strokePath(() => {
        context.beginPath();
        [34, 53, 72].forEach((y) => {
          context.moveTo(20, y);
          context.bezierCurveTo(32, y - 12, 44, y + 12, 56, y);
          context.bezierCurveTo(68, y - 12, 80, y + 12, 92, y);
        });
      });
      break;
    case "weather":
      context.save();
      context.strokeStyle = "rgba(6, 16, 25, 0.95)";
      context.fillStyle = "rgba(248, 250, 252, 0.96)";
      context.lineWidth = 9;
      context.beginPath();
      context.arc(43, 52, 15, Math.PI * 0.85, Math.PI * 1.95);
      context.arc(60, 43, 20, Math.PI * 0.95, Math.PI * 1.9);
      context.arc(78, 55, 16, Math.PI * 1.35, Math.PI * 0.1);
      context.lineTo(33, 70);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#061019";
      context.beginPath();
      context.moveTo(58, 62);
      context.lineTo(47, 96);
      context.lineTo(68, 75);
      context.lineTo(60, 106);
      context.lineTo(87, 63);
      context.closePath();
      context.fill();
      context.restore();
      break;
    case "warning":
      context.save();
      context.translate(56, 58);
      context.beginPath();
      context.moveTo(0, -42);
      context.lineTo(40, 31);
      context.lineTo(-40, 31);
      context.closePath();
      context.fillStyle = "rgba(248, 250, 252, 0.96)";
      context.fill();
      context.strokeStyle = "#061019";
      context.lineWidth = 8;
      context.stroke();
      context.beginPath();
      context.moveTo(0, -15);
      context.lineTo(0, 9);
      context.stroke();
      context.beginPath();
      context.arc(0, 22, 5, 0, Math.PI * 2);
      context.fillStyle = "#061019";
      context.fill();
      context.restore();
      break;
    case "unknown":
      context.save();
      context.translate(56, 56);
      context.strokeStyle = "#061019";
      context.fillStyle = "rgba(248, 250, 252, 0.96)";
      context.lineWidth = 9;
      context.beginPath();
      context.arc(0, 0, 34, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.font = "800 52px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#061019";
      context.fillText("?", 0, 2);
      context.restore();
      break;
  }

  return context.getImageData(0, 0, size, size);
}

function riskIconAccentColor(iconId: RiskIconId): string {
  switch (iconId) {
    case "fire":
      return "#fb923c";
    case "flood":
      return "#38bdf8";
    case "weather":
      return "#facc15";
    case "warning":
      return "#ef4444";
    case "unknown":
      return "#a78bfa";
  }
}

export function createOsmCategorySymbolImage(iconId: OsmCategoryIconId): ImageData {
  const canvas = document.createElement("canvas");
  const size = 112;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new ImageData(size, size);
  }

  const color = osmCategoryIconColor(iconId);
  context.clearRect(0, 0, size, size);
  context.lineCap = "round";
  context.lineJoin = "round";

  drawRoundedRect(context, 17, 17, 78, 78, 17);
  context.fillStyle = "rgba(6, 16, 25, 0.94)";
  context.fill();
  context.strokeStyle = "rgba(248, 250, 252, 0.9)";
  context.lineWidth = 7;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();

  context.save();
  context.translate(56, 56);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 7;

  switch (iconId) {
    case "airport":
      context.beginPath();
      context.moveTo(0, -34);
      context.lineTo(0, 34);
      context.moveTo(-28, -4);
      context.lineTo(28, -4);
      context.moveTo(-17, 20);
      context.lineTo(17, 20);
      context.stroke();
      context.beginPath();
      context.moveTo(0, -39);
      context.lineTo(8, -24);
      context.lineTo(-8, -24);
      context.closePath();
      context.fill();
      break;
    case "hospital":
      context.fillRect(-8, -28, 16, 56);
      context.fillRect(-28, -8, 56, 16);
      break;
    case "fire_station":
      context.beginPath();
      context.moveTo(0, -32);
      context.bezierCurveTo(20, -10, 18, 2, 8, 11);
      context.bezierCurveTo(18, 0, 3, -12, 2, -21);
      context.bezierCurveTo(-13, -8, -22, 3, -18, 17);
      context.bezierCurveTo(-14, 31, 14, 31, 20, 12);
      context.bezierCurveTo(24, 28, 9, 39, -8, 34);
      context.bezierCurveTo(-30, 28, -35, 2, -15, -17);
      context.bezierCurveTo(-6, -25, -4, -29, 0, -32);
      context.fill();
      break;
    case "police":
      context.beginPath();
      context.moveTo(0, -34);
      context.lineTo(26, -22);
      context.lineTo(21, 11);
      context.quadraticCurveTo(16, 27, 0, 35);
      context.quadraticCurveTo(-16, 27, -21, 11);
      context.lineTo(-26, -22);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.arc(0, -2, 8, 0, Math.PI * 2);
      context.fill();
      break;
    case "pharmacy":
      context.strokeStyle = color;
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(-8, -30);
      context.lineTo(8, -30);
      context.lineTo(8, -12);
      context.lineTo(27, -12);
      context.lineTo(27, 4);
      context.lineTo(8, 4);
      context.lineTo(8, 30);
      context.lineTo(-8, 30);
      context.lineTo(-8, 4);
      context.lineTo(-27, 4);
      context.lineTo(-27, -12);
      context.lineTo(-8, -12);
      context.closePath();
      context.stroke();
      break;
    case "shelter":
      context.beginPath();
      context.moveTo(-31, -4);
      context.lineTo(0, -31);
      context.lineTo(31, -4);
      context.stroke();
      context.beginPath();
      context.moveTo(-22, -4);
      context.lineTo(-22, 30);
      context.lineTo(22, 30);
      context.lineTo(22, -4);
      context.stroke();
      context.beginPath();
      context.moveTo(-8, 30);
      context.lineTo(-8, 10);
      context.lineTo(8, 10);
      context.lineTo(8, 30);
      context.stroke();
      break;
    case "townhall":
      context.beginPath();
      context.moveTo(-31, -17);
      context.lineTo(0, -32);
      context.lineTo(31, -17);
      context.closePath();
      context.fill();
      context.fillRect(-30, 27, 60, 8);
      [-20, 0, 20].forEach((x) => {
        context.fillRect(x - 5, -12, 10, 34);
      });
      break;
    case "communications_tower":
      context.beginPath();
      context.moveTo(0, -24);
      context.lineTo(-21, 32);
      context.moveTo(0, -24);
      context.lineTo(21, 32);
      context.moveTo(0, -24);
      context.lineTo(0, 34);
      context.moveTo(-13, 5);
      context.lineTo(13, 18);
      context.moveTo(13, 5);
      context.lineTo(-13, 18);
      context.moveTo(-25, 34);
      context.lineTo(25, 34);
      context.stroke();
      context.beginPath();
      context.arc(0, -24, 5, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(0, -24, 18, -0.72, 0.72);
      context.stroke();
      context.beginPath();
      context.arc(0, -24, 18, Math.PI - 0.72, Math.PI + 0.72);
      context.stroke();
      break;
    case "other":
      context.beginPath();
      context.arc(0, 0, 22, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "rgba(6, 16, 25, 0.94)";
      context.beginPath();
      context.arc(0, 0, 8, 0, Math.PI * 2);
      context.fill();
      break;
  }
  context.restore();

  return context.getImageData(0, 0, size, size);
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function osmCategoryIconColor(iconId: OsmCategoryIconId): string {
  switch (iconId) {
    case "airport":
      return "#38bdf8";
    case "hospital":
      return "#ef4444";
    case "fire_station":
      return "#fb923c";
    case "police":
      return "#38bdf8";
    case "pharmacy":
      return "#22c55e";
    case "shelter":
      return "#facc15";
    case "townhall":
      return "#c4b5fd";
    case "communications_tower":
      return "#8cb6d8";
    case "other":
      return "#dff8ff";
  }
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("NATO symbol SVG se nepodařilo načíst."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
