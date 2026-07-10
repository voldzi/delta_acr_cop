import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");

describe("cop-chat embedded mobile layout CSS", () => {
  it("binds the embedded shell to the iframe box instead of the viewport", () => {
    const rootBlock = cssBlock("html,\nbody,\n#root");
    expect(rootBlock).toContain("height: 100%");
    expect(rootBlock).toContain("min-height: 100%");

    const embeddedShellBlock = cssBlock(".wa-shell.embedded");
    expect(embeddedShellBlock).toContain("position: relative");
    expect(embeddedShellBlock).toContain("height: 100%");
    expect(embeddedShellBlock).toContain("min-height: 0");
    expect(embeddedShellBlock).toContain("max-height: 100%");
    expect(embeddedShellBlock).not.toContain("100dvh");
  });

  it("keeps the embedded conversation pane inside the iframe height", () => {
    const conversationPaneBlock = cssBlock(".wa-shell.embedded .conversation-pane");
    expect(conversationPaneBlock).toContain("position: absolute");
    expect(conversationPaneBlock).toContain("height: 100%");
    expect(conversationPaneBlock).toContain("min-height: 0");
    expect(conversationPaneBlock).toContain("max-height: 100%");
    expect(conversationPaneBlock).not.toContain("position: fixed");
    expect(conversationPaneBlock).not.toContain("100dvh");
  });

  it("keeps mobile list, conversation and composer controls outside iPhone safe areas", () => {
    expect(cssBlocks(".list-header").some((block) => block.includes("env(safe-area-inset-top, 0px)"))).toBe(true);
    expect(cssBlocks(".conversation-header").some((block) => block.includes("env(safe-area-inset-top, 0px)"))).toBe(
      true
    );
    expect(cssBlocks(".composer").some((block) => block.includes("env(safe-area-inset-bottom, 0px)"))).toBe(true);
  });
});

function cssBlock(selector: string): string {
  const blocks = cssBlocks(selector);
  if (!blocks[0]) {
    throw new Error(`CSS selector not found: ${selector}`);
  }
  return blocks[0];
}

function cssBlocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\s*");
  return Array.from(styles.matchAll(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "gu")))
    .map((match) => match.groups?.body)
    .filter((body): body is string => Boolean(body));
}
