// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherForecastAreaDetail, type SituationFeature, type WeatherForecastAreaDetailResponse } from "./cop-data";
import { WeatherForecastAreaDetailPanel } from "./weather-detail";

vi.mock("./cop-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cop-data")>();
  return {
    ...actual,
    fetchWeatherForecastAreaDetail: vi.fn(),
    fetchWeatherStationDetail: vi.fn()
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(fetchWeatherForecastAreaDetail).mockReset();
});

function forecastAreaFeature(): SituationFeature {
  return {
    geometry: {
      coordinates: [[
        [15, 49.5],
        [15.75, 49.5],
        [15.75, 50.25],
        [15, 50.25],
        [15, 49.5]
      ]],
      type: "Polygon"
    },
    properties: {
      category: "weather",
      confidence: 0.82,
      featureId: "forecast-area:15:49.5:0.75",
      label: "polojasno, 27 °C",
      layer: "weather_forecast_area",
      layerId: "public.weather.forecast_area",
      providerLayerId: "weather_forecast_area",
      providerProperties: {
        display: {
          chartUrl: "/api/v1/weather-forecast/areas/15:49.5:0.75/meteogram",
          detailType: "weather_forecast_meteogram",
          primaryValue: "polojasno, 27 °C",
          subtitle: "Předpověď počasí",
          title: "polojasno, 27 °C"
        }
      },
      sourceId: "weather_forecast",
      sourceName: "SIM weather forecast"
    },
    type: "Feature"
  } as SituationFeature;
}

describe("weather forecast area detail", () => {
  it("renders SIM meteogram chart points encoded as t/v pairs", async () => {
    const detail = {
      attribution: "Zdroj: Český hydrometeorologický ústav",
      charts: [
        {
          id: "temperature",
          series: [
            {
              key: "temperature",
              labelCs: "Teplota",
              points: [
                { t: "2026-07-02T14:00:00.000Z", v: 21.2 },
                { t: "2026-07-02T15:00:00.000Z", v: 28.6 }
              ],
              unit: "°C"
            }
          ],
          titleCs: "Teplota"
        }
      ],
      contractVersion: "sim-weather-forecast-area-detail-v1",
      current: {
        display: {
          primaryValue: "polojasno, 27 °C",
          subtitle: "Předpověď počasí",
          title: "polojasno, 27 °C"
        }
      },
      generatedAt: "2026-07-02T14:24:46.000Z",
      hourly: {
        pointCount: 48,
        points: []
      }
    } satisfies WeatherForecastAreaDetailResponse;

    vi.mocked(fetchWeatherForecastAreaDetail).mockResolvedValue(detail);

    render(<WeatherForecastAreaDetailPanel apiBase="" authToken={undefined} feature={forecastAreaFeature()} />);

    await waitFor(() => expect(fetchWeatherForecastAreaDetail).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("Teplota").length).toBeGreaterThan(0));
    expect(screen.getByRole("img", { name: "Graf počasí" })).toBeTruthy();
    expect(screen.queryByText("Meteogram zatím neobsahuje datové body.")).toBeNull();
  });

  it("shows an exact chart readout on pointer hover", async () => {
    const detail = {
      attribution: "Zdroj: Český hydrometeorologický ústav",
      charts: [
        {
          id: "temperature",
          series: [
            {
              key: "temperature",
              labelCs: "Teplota",
              points: [
                { t: "2026-07-02T14:00:00.000Z", v: 21.2 },
                { t: "2026-07-02T15:00:00.000Z", v: 28.6 }
              ],
              unit: "°C"
            }
          ],
          titleCs: "Teplota"
        }
      ],
      contractVersion: "sim-weather-forecast-area-detail-v1",
      current: {
        display: {
          primaryValue: "polojasno, 27 °C",
          subtitle: "Předpověď počasí",
          title: "polojasno, 27 °C"
        }
      },
      generatedAt: "2026-07-02T14:24:46.000Z",
      hourly: {
        pointCount: 48,
        points: []
      }
    } satisfies WeatherForecastAreaDetailResponse;

    vi.mocked(fetchWeatherForecastAreaDetail).mockResolvedValue(detail);

    render(<WeatherForecastAreaDetailPanel apiBase="" authToken={undefined} feature={forecastAreaFeature()} />);

    const chart = await screen.findByRole("img", { name: "Graf počasí" });
    fireEvent.pointerMove(chart, { clientX: 600, clientY: 80, pointerId: 1 });

    expect(await screen.findByText(/Teplota: 29 °C/)).toBeTruthy();
  });
});
