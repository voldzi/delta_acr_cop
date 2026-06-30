import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFloodTrendSymbolImage,
  createMobileNetworkSymbolImage,
  createOsmCategorySymbolImage,
  createRiskSymbolImage,
  createTransitSymbolImage,
  createWeatherCameraSymbolImage,
  createWeatherConditionSymbolImage,
  createWeatherWindArrowImage,
  floodStageTones,
  floodTrendDirections,
  getFloodTrendIconKey,
  getMobileNetworkIconKey,
  getOsmCategoryIconKey,
  getRiskIconKey,
  getTransitIconKey,
  getWeatherConditionIconKey,
  mobileNetworkIconTones,
  normalizeWeatherConditionIconId,
  osmCategoryIconIds,
  riskIconIds,
  weatherCameraIconKey,
  weatherConditionIconIds,
  weatherWindIconKey
} from "./map-symbol-rendering";
import { transportIconKinds } from "./transport-presentation";

class TestImageData {
  data: Uint8ClampedArray;
  height: number;
  width: number;

  constructor(width: number, height: number, operationCount = 0, signature = 0) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    let seed = (signature ^ width ^ (height << 8) ^ operationCount) >>> 0;
    const sampleLength = Math.min(this.data.length, 96);
    for (let index = 0; index < sampleLength; index += 1) {
      seed = (Math.imul(seed ^ index, 1664525) + 1013904223) >>> 0;
      this.data[index] = seed & 0xff;
    }
    this.data[0] = operationCount & 0xff;
    this.data[1] = (operationCount >> 8) & 0xff;
    this.data[2] = signature & 0xff;
    this.data[3] = Math.max(1, Math.min(255, operationCount));
  }
}

class TestGradient {
  addColorStop() {
    // CSS gradient stops are not relevant for the symbol contract.
  }
}

class TestCanvasContext {
  fillStyle = "";
  font = "";
  globalAlpha = 1;
  lineCap = "butt";
  lineJoin = "miter";
  lineWidth = 1;
  shadowBlur = 0;
  shadowColor = "";
  shadowOffsetY = 0;
  strokeStyle = "";
  textAlign = "start";
  textBaseline = "alphabetic";

  private operations = 0;
  private signature = 0x811c9dc5;

  arc(...args: unknown[]) { this.touch("arc", args); }
  beginPath(...args: unknown[]) { this.touch("beginPath", args); }
  bezierCurveTo(...args: unknown[]) { this.touch("bezierCurveTo", args); }
  clearRect(...args: unknown[]) { this.touch("clearRect", args); }
  closePath(...args: unknown[]) { this.touch("closePath", args); }
  createLinearGradient(...args: unknown[]) { this.touch("createLinearGradient", args); return new TestGradient(); }
  drawImage(...args: unknown[]) { this.touch("drawImage", args); }
  ellipse(...args: unknown[]) { this.touch("ellipse", args); }
  fill(...args: unknown[]) { this.touch("fill", args); }
  fillRect(...args: unknown[]) { this.touch("fillRect", args); }
  fillText(...args: unknown[]) { this.touch("fillText", args); }
  getImageData(_x: number, _y: number, width: number, height: number) {
    this.touch("getImageData", [width, height]);
    return new TestImageData(width, height, this.operations, this.signature);
  }
  lineTo(...args: unknown[]) { this.touch("lineTo", args); }
  moveTo(...args: unknown[]) { this.touch("moveTo", args); }
  quadraticCurveTo(...args: unknown[]) { this.touch("quadraticCurveTo", args); }
  restore(...args: unknown[]) { this.touch("restore", args); }
  rotate(...args: unknown[]) { this.touch("rotate", args); }
  roundRect(...args: unknown[]) { this.touch("roundRect", args); }
  save(...args: unknown[]) { this.touch("save", args); }
  scale(...args: unknown[]) { this.touch("scale", args); }
  stroke(...args: unknown[]) { this.touch("stroke", args); }
  translate(...args: unknown[]) { this.touch("translate", args); }

  private touch(method: string, args: unknown[] = []) {
    this.operations += 1;
    const styleState = [
      this.fillStyle,
      this.font,
      this.globalAlpha,
      this.lineCap,
      this.lineJoin,
      this.lineWidth,
      this.strokeStyle,
      this.textAlign,
      this.textBaseline
    ].join("|");
    const payload = `${method}:${args.map(String).join(",")}:${styleState}`;
    for (let index = 0; index < payload.length; index += 1) {
      this.signature ^= payload.charCodeAt(index);
      this.signature = Math.imul(this.signature, 16777619) >>> 0;
    }
  }
}

function installCanvasStubs() {
  vi.stubGlobal("ImageData", TestImageData);
  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "canvas") {
        throw new Error(`Unexpected element: ${tagName}`);
      }
      return {
        height: 0,
        width: 0,
        getContext(contextId: string) {
          return contextId === "2d" ? new TestCanvasContext() : null;
        }
      };
    }
  });
}

function expectDrawnImage(image: ImageData, width: number, height = width) {
  expect(image.width).toBe(width);
  expect(image.height).toBe(height);
  expect(image.data[3]).toBeGreaterThan(0);
}

function imageFingerprint(image: ImageData): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < Math.min(96, image.data.length); index += 1) {
    hash ^= image.data[index] ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${image.width}x${image.height}:${hash.toString(16).padStart(8, "0")}`;
}

describe("map symbol rendering contract", () => {
  beforeEach(() => installCanvasStubs());
  afterEach(() => vi.unstubAllGlobals());

  it("keeps stable maplibre image keys for every symbol family", () => {
    expect(mobileNetworkIconTones.map(getMobileNetworkIconKey)).toContain("cop-mobile-network-critical");
    expect(osmCategoryIconIds.map(getOsmCategoryIconKey)).toContain("cop-osm-category-communications_tower");
    expect(riskIconIds.map(getRiskIconKey)).toEqual([
      "cop-risk-fire",
      "cop-risk-flood",
      "cop-risk-warning",
      "cop-risk-weather",
      "cop-risk-unknown"
    ]);
    expect(transportIconKinds.map(getTransitIconKey)).toContain("cop-transit-road_event");
    expect(weatherConditionIconIds.map(getWeatherConditionIconKey)).toContain("cop-weather-condition-measurement_temperature");
    expect(floodTrendDirections.flatMap((direction) => floodStageTones.map((tone) => getFloodTrendIconKey(direction, tone))))
      .toContain("cop-flood-trend-rising-critical");
    expect(weatherWindIconKey).toBe("cop-weather-wind-arrow");
    expect(weatherCameraIconKey).toBe("cop-weather-camera");
  });

  it("normalizes weather provider icon aliases without inventing partly cloudy for measurements", () => {
    expect(normalizeWeatherConditionIconId("polojasno")).toBe("partly_cloudy");
    expect(normalizeWeatherConditionIconId("measurement")).toBe("measurement");
    expect(normalizeWeatherConditionIconId("wind-gauge")).toBe("measurement_wind");
    expect(normalizeWeatherConditionIconId("unknown-provider-state")).toBe("unknown");
  });

  it("renders weather, hydro, camera, network, OSM, transport and risk icons with stable dimensions", () => {
    weatherConditionIconIds.forEach((iconId) => expectDrawnImage(createWeatherConditionSymbolImage(iconId), 128));
    mobileNetworkIconTones.forEach((tone) => expectDrawnImage(createMobileNetworkSymbolImage(tone), 128));
    osmCategoryIconIds.forEach((iconId) => expectDrawnImage(createOsmCategorySymbolImage(iconId), 112));
    riskIconIds.forEach((iconId) => expectDrawnImage(createRiskSymbolImage(iconId), 112));
    transportIconKinds.forEach((kind) => expectDrawnImage(createTransitSymbolImage(kind), 128));
    floodTrendDirections.forEach((direction) => {
      floodStageTones.forEach((tone) => expectDrawnImage(createFloodTrendSymbolImage(direction, tone), 92));
    });
    expectDrawnImage(createWeatherWindArrowImage(), 96);
    expectDrawnImage(createWeatherCameraSymbolImage(), 128);
  });

  it("keeps deterministic visual fingerprints for operator-facing map symbols", () => {
    const fingerprints = {
      flood: Object.fromEntries(
        floodTrendDirections.flatMap((direction) => (
          floodStageTones.map((tone) => [`${direction}-${tone}`, imageFingerprint(createFloodTrendSymbolImage(direction, tone))])
        ))
      ),
      mobile: Object.fromEntries(
        mobileNetworkIconTones.map((tone) => [tone, imageFingerprint(createMobileNetworkSymbolImage(tone))])
      ),
      risk: Object.fromEntries(
        riskIconIds.map((iconId) => [iconId, imageFingerprint(createRiskSymbolImage(iconId))])
      ),
      transit: Object.fromEntries(
        transportIconKinds.map((kind) => [kind, imageFingerprint(createTransitSymbolImage(kind))])
      ),
      weather: Object.fromEntries(
        weatherConditionIconIds.map((iconId) => [iconId, imageFingerprint(createWeatherConditionSymbolImage(iconId))])
      ),
      weatherCamera: imageFingerprint(createWeatherCameraSymbolImage()),
      wind: imageFingerprint(createWeatherWindArrowImage())
    };
    expect(fingerprints).toMatchInlineSnapshot(`
      {
        "flood": {
          "falling-critical": "92x92:0e38966b",
          "falling-ok": "92x92:ff0149e4",
          "falling-warn": "92x92:2d3af891",
          "rising-critical": "92x92:192a90ce",
          "rising-ok": "92x92:0c6337f3",
          "rising-warn": "92x92:5c068f38",
          "stable-critical": "92x92:ae9aeb22",
          "stable-ok": "92x92:1c8db50b",
          "stable-warn": "92x92:1a253f5c",
        },
        "mobile": {
          "advisory": "128x128:4bf92a38",
          "critical": "128x128:8e2d877c",
          "info": "128x128:2d80a92e",
          "reference": "128x128:70a94fac",
          "unknown": "128x128:7341bd10",
          "warning": "128x128:b30fa768",
        },
        "risk": {
          "fire": "112x112:e400a284",
          "flood": "112x112:17214e9f",
          "unknown": "112x112:f9964b28",
          "warning": "112x112:26cb8b02",
          "weather": "112x112:7d82bcf2",
        },
        "transit": {
          "bus": "128x128:f1df4846",
          "ferry": "128x128:d191eda3",
          "funicular": "128x128:b0feb6a1",
          "metro": "128x128:ecae5a58",
          "road_event": "128x128:7b8040fd",
          "traffic": "128x128:d29cf671",
          "train": "128x128:623f36cb",
          "tram": "128x128:bf5d2a7a",
          "trolleybus": "128x128:499e703a",
          "unknown": "128x128:2408d569",
        },
        "weather": {
          "cloud": "128x128:1b98ab6d",
          "fog": "128x128:0e03166a",
          "measurement": "128x128:bec6fb97",
          "measurement_humidity": "128x128:25b9be77",
          "measurement_rain": "128x128:1f1b2945",
          "measurement_temperature": "128x128:d4ad2fae",
          "measurement_wind": "128x128:07346ba4",
          "partly_cloudy": "128x128:47b6fe33",
          "rain": "128x128:0251744a",
          "snow": "128x128:c1f83a18",
          "storm": "128x128:30ec97e6",
          "sun": "128x128:765df3b8",
          "unknown": "128x128:69d5af5b",
          "wind": "128x128:c817949a",
        },
        "weatherCamera": "128x128:cecce82e",
        "wind": "96x96:bdccf506",
      }
    `);
  });
});
