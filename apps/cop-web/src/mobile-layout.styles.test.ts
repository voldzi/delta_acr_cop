import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainPath = fileURLToPath(new URL("./main.tsx", import.meta.url));
const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const manifestPath = fileURLToPath(new URL("../public/site.webmanifest", import.meta.url));
const mainSource = readFileSync(mainPath, "utf8");
const styles = readFileSync(stylesPath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { orientation?: string };

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

  it("prevents iOS focus zoom and min-content overflow in the selected-contact mode", () => {
    const mobileTextControls = cssBlocks(
      '.report-dialog input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),\n  .report-dialog textarea,\n  .report-dialog .ui-select-trigger'
    ).find((block) => block.includes("font-size: 16px"));
    const accessHeader = cssBlock(".report-access-header");
    const accessPanel = cssBlock(".report-access-panel");

    expect(mobileTextControls).toBeTruthy();
    expect(accessHeader).toContain("display: flex");
    expect(accessHeader).toContain("flex-wrap: wrap");
    expect(accessPanel).toContain("min-width: 0");
  });

  it("keeps the modal overlay and its actions above the fixed mobile navigation", () => {
    const overlayZIndex = cssNumericProperty(".ui-dialog-overlay", "z-index");
    const contentZIndex = cssNumericProperty(".ui-dialog-content", "z-index");
    const mobileNavigationZIndex = cssNumericProperty(".mobile-bottom-nav", "z-index");

    expect(overlayZIndex).toBeGreaterThan(mobileNavigationZIndex);
    expect(contentZIndex).toBeGreaterThan(overlayZIndex);
  });
});

describe("COP standalone iPhone safe areas", () => {
  it("keeps the top bar below the status area", () => {
    const mobileTopbar = cssBlocks(".shell.app-shell-v2 .topbar").find((block) =>
      block.includes("env(safe-area-inset-top, 0px)")
    );
    const mobileSheet = cssBlocks(".mobile-sheet-layer").find((block) =>
      block.includes("env(safe-area-inset-top, 0px)")
    );

    expect(mobileTopbar).toContain("min-height: calc(54px + env(safe-area-inset-top, 0px))");
    expect(mobileTopbar).toContain("padding: calc(6px + env(safe-area-inset-top, 0px)) 8px 6px");
    expect(mobileSheet).toContain("top: calc(54px + env(safe-area-inset-top, 0px))");
  });

  it("fills both compact and Max screens without relying on the shorter iOS dvh viewport", () => {
    const mobileShell = cssBlocks(".shell.app-shell-v2").find((block) =>
      block.includes("grid-template-rows: auto minmax(0, 1fr) auto")
    );
    const mobileBody = cssBlocks(".shell.app-shell-v2 .app-shell-body").find((block) => block.includes("grid-row: 2"));
    const mobileNavigation = cssBlocks(".mobile-bottom-nav").find((block) => block.includes("grid-row: 3"));

    expect(mobileShell).toContain("height: 100%");
    expect(mobileShell).not.toContain("100dvh");
    expect(mobileBody).toContain("height: auto");
    expect(mobileBody).toContain("padding-bottom: 0");
    expect(mobileNavigation).toContain("position: relative");
    expect(mobileNavigation).toContain("max(7px, env(safe-area-inset-bottom, 0px))");
  });

  it("extends an installed iPhone shell by the top inset that iOS omits from the percentage viewport", () => {
    const standaloneShell = cssBlock(".shell.app-shell-v2.pwa-standalone");

    expect(mainSource).toContain('isStandalonePwaRuntime() && "pwa-standalone"');
    expect(standaloneShell).toContain("height: calc(100% + env(safe-area-inset-top, 0px))");
  });

  it("requests portrait PWA orientation and provides a landscape fallback guard", () => {
    const orientationGuard = cssBlock(".shell.app-shell-v2.pwa-standalone > .pwa-orientation-guard");

    expect(manifest.orientation).toBe("portrait");
    expect(mainSource).toContain('className="pwa-orientation-guard"');
    expect(orientationGuard).toContain("z-index: 1000");
    expect(orientationGuard).toContain("height: calc(100% + env(safe-area-inset-top, 0px))");
  });

  it("anchors the map legend to the responsive map edge instead of reserving the navigation twice", () => {
    const mobileLegend = cssBlocks(".shell.app-shell-v2 .map-legend").find((block) => block.includes("left: 12px"));
    const collapsedLegend = cssBlock(".shell.app-shell-v2 .map-legend.collapsed");

    expect(mobileLegend).toContain("bottom: 12px");
    expect(mobileLegend).toContain("right: 72px");
    expect(collapsedLegend).toContain("right: 12px");
    expect(mobileLegend).not.toContain("--mobile-bottom-nav-height");
  });

  it("keeps fullscreen map controls outside every iPhone safe area", () => {
    const fullscreenSearch = cssBlock(".map-container.fullscreen .map-global-search");
    const fullscreenControls = cssBlock(".map-container.fullscreen .map-control-palette");
    const fullscreenLegend = cssBlock(".map-container.fullscreen .map-legend");

    expect(fullscreenSearch).toContain("env(safe-area-inset-top, 0px)");
    expect(fullscreenControls).toContain("env(safe-area-inset-right, 0px)");
    expect(fullscreenControls).toContain("env(safe-area-inset-bottom, 0px)");
    expect(fullscreenLegend).toContain("env(safe-area-inset-bottom, 0px)");
    expect(styles).not.toMatch(/env\(safe-area-inset-(?:top|right|bottom|left)\)/u);
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

describe("COP compact phone design floor", () => {
  it("removes clipped mission copy and preserves the alert badge at 360px", () => {
    const compactMission = cssBlocks(".shell.app-shell-v2 .mission-strip").find((block) =>
      block.includes("grid-template-columns: minmax(0, 1fr)")
    );
    const compactMissionCopy = cssBlocks(
      ".shell.app-shell-v2 .mission-strip strong,\n  .shell.app-shell-v2 .mission-strip small"
    ).find((block) => block.includes("display: none"));

    expect(compactMission).toBeTruthy();
    expect(compactMissionCopy).toBeTruthy();
  });

  it("keeps map search, sheet and settings actions touch sized", () => {
    const searchActions = cssBlocks(
      ".shell.app-shell-v2 .map-global-search-drag,\n  .shell.app-shell-v2 .map-global-search-dock"
    ).find((block) => block.includes("min-height: 40px"));
    const sheetAndDialogActions = cssBlocks(
      ".mobile-sheet-header button,\n  .settings-header .icon-button,\n  .ui-dialog-header .icon-button"
    ).find((block) => block.includes("min-height: 44px"));
    const settingsTabs = cssBlocks(".settings-tabs button").find((block) => block.includes("min-height: 44px"));

    expect(searchActions).toContain("min-width: 40px");
    expect(sheetAndDialogActions).toContain("min-width: 44px");
    expect(settingsTabs).toBeTruthy();
  });

  it("keeps every mobile map control, legend toggle and search action at least 40px", () => {
    const mapControls = cssBlocks(
      ".map-control-drag,\n  .map-control-main,\n  .map-control-button.icon-only,\n  .map-control-button"
    ).find((block) => block.includes("width: 40px"));
    const legendToggle = cssBlocks(".shell.app-shell-v2 .map-legend-toggle").find((block) =>
      block.includes("width: 40px")
    );
    const searchActions = cssBlocks(
      ".shell.app-shell-v2 .map-global-search-drag,\n  .shell.app-shell-v2 .map-global-search-docked-mark,\n  .shell.app-shell-v2 .map-global-search-clear,\n  .shell.app-shell-v2 .map-global-search-dock,\n  .shell.app-shell-v2 .map-global-search-reset"
    ).find((block) => block.includes("width: 40px"));
    const palette = cssBlocks(".map-control-palette").find((block) => block.includes("max-height: calc(100% - 86px)"));

    expect(mapControls).toContain("min-height: 40px");
    expect(legendToggle).toContain("height: 40px");
    expect(searchActions).toContain("min-height: 40px");
    expect(palette).toContain("overflow-y: auto");
  });

  it("lets docked search expand to the phone width without losing its compact launcher", () => {
    const expanded = cssBlocks(".shell.app-shell-v2 .map-global-search.is-docked").find((block) =>
      block.includes("position: absolute")
    );
    const collapsed = cssBlock(".shell.app-shell-v2 .map-global-search.is-docked.is-collapsed");

    expect(expanded).toContain("right: 12px");
    expect(expanded).toContain("width: auto");
    expect(collapsed).toContain("right: auto");
    expect(collapsed).toContain("width: 52px");
  });

  it("prevents iOS focus zoom across all native text controls", () => {
    const mobileTextControls = cssBlock(
      'html :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea)'
    );

    expect(mobileTextControls).toContain("font-size: 16px");
  });

  it("removes full-screen backdrop blur from the mobile compositing path", () => {
    const mobileBackdrops = cssBlock(
      ".ui-dialog-overlay,\n  .tomato-game-backdrop,\n  .community-gallery-backdrop,\n  .settings-backdrop,\n  .mobile-pair-landing-backdrop,\n  .shell.app-shell-v2 .messaging-panel"
    );

    expect(mobileBackdrops).toContain("-webkit-backdrop-filter: none");
    expect(mobileBackdrops).toContain("backdrop-filter: none");
  });

  it("turns settings and help into bounded full-height compact surfaces", () => {
    const settingsDrawer = cssBlocks(".settings-drawer").find((block) => block.includes("max-height: 100%"));
    const settingsContent = cssBlocks(".settings-content").find((block) =>
      block.includes("env(safe-area-inset-bottom, 0px)")
    );
    const manualDialog = cssBlocks(".manual-dialog").find((block) => block.includes("height: 100dvh"));

    expect(settingsDrawer).toContain("width: 100vw");
    expect(settingsDrawer).toContain("height: 100%");
    expect(settingsContent).toContain("overscroll-behavior: contain");
    expect(manualDialog).toContain("max-height: 100dvh");
  });

  it("gives the Radix manual a bounded surface with one scroll owner", () => {
    const manualDialog = cssBlocks(".manual-dialog").find((block) =>
      block.includes("grid-template-rows: auto minmax(0, 1fr)")
    );
    const manualContent = cssBlock(".manual-dialog .manual-layout");
    const responsiveManualContent = cssBlocks(".manual-dialog .manual-layout").find((block) =>
      block.includes("grid-template-columns: 1fr")
    );
    const compactManual = cssBlocks(".manual-dialog").find((block) => block.includes("height: 100dvh"));

    expect(manualDialog).toContain("max-height: min(720px, calc(100svh - 32px))");
    expect(manualDialog).toContain("overflow: hidden");
    expect(manualContent).toContain("min-height: 0");
    expect(manualContent).toContain("overflow: auto");
    expect(responsiveManualContent).toContain("grid-template-columns: 1fr");
    expect(compactManual).toContain("env(safe-area-inset-top, 0px)");
    expect(compactManual).toContain("env(safe-area-inset-bottom, 0px)");
  });

  it("bounds authentication dialogs on short phones", () => {
    const authDialogs = cssBlocks(".login-required-dialog,\n  .account-changed-dialog").find((block) =>
      block.includes("max-height: calc(100dvh")
    );

    expect(authDialogs).toContain("overflow-y: auto");
    expect(authDialogs).toContain("overscroll-behavior: contain");
  });

  it("stacks critical report actions on 360px screens", () => {
    const actions = cssBlocks(".ui-dialog-actions").find((block) => block.includes("grid-template-columns: 1fr"));
    const buttons = cssBlocks(".ui-dialog-actions .primary-button,\n  .ui-dialog-actions .ghost-button").find((block) =>
      block.includes("min-height: 46px")
    );

    expect(actions).toBeTruthy();
    expect(buttons).toContain("width: 100%");
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
