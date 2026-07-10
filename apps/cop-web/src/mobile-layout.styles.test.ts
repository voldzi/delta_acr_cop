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
});

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
