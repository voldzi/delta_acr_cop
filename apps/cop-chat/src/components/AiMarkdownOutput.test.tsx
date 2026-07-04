// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiMarkdownOutput } from "./AiMarkdownOutput";

describe("AiMarkdownOutput", () => {
  it("renders common AI markdown as structured chat content", () => {
    render(
      <AiMarkdownOutput
        query="zdrojů"
        text={[
          "### Situační souhrn: Civilní krizový přehled",
          "",
          "**Časový údaj:** 2026-07-04T09:26:09.325Z",
          "",
          "#### 1. Ověřená data",
          "* **Počet aktivních objektů:** 24 letadla.",
          "  * **Stav zdrojů:** ONLINE.",
          "",
          "| Zdroj | Stav |",
          "| --- | --- |",
          "| SIM Safety Data | DEGRADED |",
          "",
          "> Ověřit konfliktní evidence před rozhodnutím.",
          "",
          "Značka `conflict evidence present` vyžaduje kontrolu."
        ].join("\n")}
      />
    );

    expect(screen.getByRole("heading", { name: "Situační souhrn: Civilní krizový přehled" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1. Ověřená data" })).toBeTruthy();
    expect(screen.getByText("Časový údaj:")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Zdroj" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "DEGRADED" })).toBeTruthy();
    expect(screen.getByText("Ověřit konfliktní evidence před rozhodnutím.")).toBeTruthy();
    expect(screen.getByText("conflict evidence present")).toBeTruthy();
    expect(screen.getByText("zdrojů")).toBeTruthy();
    expect(screen.queryByText(/### Situační/u)).toBeNull();
    expect(screen.queryByText(/\*\*Časový údaj/u)).toBeNull();
  });
});
