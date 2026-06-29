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

  constructor(width: number, height: number, operationCount = 0) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.data[3] = Math.min(255, operationCount);
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

  arc() { this.touch(); }
  beginPath() { this.touch(); }
  bezierCurveTo() { this.touch(); }
  clearRect() { this.touch(); }
  closePath() { this.touch(); }
  createLinearGradient() { this.touch(); return new TestGradient(); }
  drawImage() { this.touch(); }
  ellipse() { this.touch(); }
  fill() { this.touch(); }
  fillRect() { this.touch(); }
  fillText() { this.touch(); }
  getImageData(_x: number, _y: number, width: number, height: number) {
    return new TestImageData(width, height, this.operations);
  }
  lineTo() { this.touch(); }
  moveTo() { this.touch(); }
  quadraticCurveTo() { this.touch(); }
  restore() { this.touch(); }
  rotate() { this.touch(); }
  roundRect() { this.touch(); }
  save() { this.touch(); }
  scale() { this.touch(); }
  stroke() { this.touch(); }
  translate() { this.touch(); }

  private touch() {
    this.operations += 1;
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
});
