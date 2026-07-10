import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainPath = fileURLToPath(new URL("./main.tsx", import.meta.url));
const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const mainSource = readFileSync(mainPath, "utf8");
const styles = readFileSync(stylesPath, "utf8");

describe("COP mobile report dialog layout", () => {
  it("keeps the long form scrollable while actions remain in a fixed dialog row", () => {
    expect(mainSource).toContain('className="report-dialog-scroll"');
    expect(cssBlock(".report-dialog")).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(cssBlock(".report-dialog")).toContain("overflow: hidden");
    expect(cssBlock(".report-dialog-scroll")).toContain("overflow-y: auto");
  });

  it("positions the mobile report dialog between the iPhone safe areas", () => {
    const mobileBlocks = cssBlocks(".ui-dialog-content.report-dialog");
    expect(mobileBlocks.some((block) => block.includes("env(safe-area-inset-top, 0px)"))).toBe(true);
    expect(mobileBlocks.some((block) => block.includes("env(safe-area-inset-bottom, 0px)"))).toBe(true);
  });

  it("keeps the modal overlay and its actions above the fixed mobile navigation", () => {
    const overlayZIndex = cssNumericProperty(".ui-dialog-overlay", "z-index");
    const contentZIndex = cssNumericProperty(".ui-dialog-content", "z-index");
    const mobileNavigationZIndex = cssNumericProperty(".mobile-bottom-nav", "z-index");

    expect(overlayZIndex).toBeGreaterThan(mobileNavigationZIndex);
    expect(contentZIndex).toBeGreaterThan(overlayZIndex);
  });
});

describe("COP mobile layer catalog layout", () => {
  it("normalizes iOS button rendering without clipping the active weather border", () => {
    const catalogButton = cssBlocks(".catalog-rail-button").find((block) => block.includes("appearance:"));
    const mobileCatalogButton = cssBlocks(".mobile-sheet-surface .catalog-rail-button").find((block) =>
      block.includes("contain: layout style")
    );

    expect(catalogButton).toContain("appearance: none");
    expect(catalogButton).toContain("-webkit-appearance: none");
    expect(catalogButton).toContain("background-clip: padding-box");
    expect(mobileCatalogButton).toContain("contain: layout style");
    expect(mobileCatalogButton).not.toContain("paint");
  });

  it("keeps weather metadata inside each scrollable catalog row", () => {
    const catalogList = cssBlocks(".mobile-sheet-surface .catalog-layer-list").find((block) =>
      block.includes("grid-auto-rows:")
    );
    const catalogRow = cssBlocks(".mobile-sheet-surface .catalog-layer-row").find((block) =>
      block.includes("align-self:")
    );

    expect(catalogList).toContain("align-content: start");
    expect(catalogList).toContain("grid-auto-rows: max-content");
    expect(catalogRow).toContain("align-self: start");
  });
});

function cssNumericProperty(selector: string, property: string): number {
  const match = cssBlock(selector).match(new RegExp(`${property}:\\s*(?<value>\\d+)`, "u"));
  const value = Number(match?.groups?.value);
  if (!Number.isFinite(value)) {
    throw new Error(`Numeric CSS property not found: ${selector} ${property}`);
  }
  return value;
}

function cssBlock(selector: string): string {
  const block = cssBlocks(selector)[0];
  if (!block) {
    throw new Error(`CSS selector not found: ${selector}`);
  }
  return block;
}

function cssBlocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\s*");
  return Array.from(styles.matchAll(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "gu")))
    .map((match) => match.groups?.body)
    .filter((body): body is string => Boolean(body));
}
