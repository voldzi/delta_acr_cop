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

  it("reserves long press for message reactions without blocking vertical scrolling", () => {
    const messageRowBlock = cssBlock(".message-row");
    expect(messageRowBlock).toContain("-webkit-touch-callout: none");
    expect(messageRowBlock).toContain("-webkit-user-select: none");
    expect(messageRowBlock).toContain("user-select: none");
    expect(messageRowBlock).toContain("touch-action: pan-y pinch-zoom");
  });

  it("keeps the mobile composer directly focusable by iOS", () => {
    const messageInputBlocks = cssBlocks(".message-input");
    const textareaBlocks = cssBlocks(".message-input textarea");
    expect(messageInputBlocks.some((block) => block.includes("touch-action: manipulation"))).toBe(true);
    expect(textareaBlocks.some((block) => block.includes("touch-action: manipulation"))).toBe(true);
    expect(textareaBlocks.some((block) => block.includes("-webkit-user-select: text"))).toBe(true);
    expect(textareaBlocks.some((block) => block.includes("user-select: text"))).toBe(true);
    expect(textareaBlocks.some((block) => block.includes("font-size: 16px"))).toBe(true);
  });

  it("routes taps only to the currently visible swipe action panel", () => {
    expect(cssBlock(".chat-swipe-actions")).toContain("pointer-events: none");
    expect(cssBlock('.chat-swipe-actions[aria-hidden="false"]')).toContain("pointer-events: auto");
    expect(cssBlocks(".row-actions-toggle").some((block) => block.includes("display: grid"))).toBe(true);
  });

  it("keeps embedded overlays inside the iframe instead of the top-level viewport", () => {
    const embeddedDialogBackdrop = cssBlock(
      ".wa-shell.embedded .dialog-backdrop,\n.wa-shell.embedded .preview-backdrop,\n.wa-shell.embedded .info-backdrop,\n.wa-shell.embedded .mute-backdrop"
    );
    const embeddedInfoPanel = cssBlocks(".wa-shell.embedded .info-panel");
    const embeddedDialog = cssBlock(
      ".wa-shell.embedded .new-chat-dialog,\n.wa-shell.embedded .ai-situation-dialog,\n.wa-shell.embedded .ai-agent-dialog,\n.wa-shell.embedded .preview-dialog,\n.wa-shell.embedded .forward-dialog,\n.wa-shell.embedded .retention-dialog,\n.wa-shell.embedded .recovery-dialog"
    );

    expect(embeddedDialogBackdrop).toContain("position: absolute");
    expect(embeddedDialogBackdrop).toContain("max-height: 100%");
    expect(embeddedInfoPanel.some((block) => block.includes("height: 100%"))).toBe(true);
    expect(embeddedInfoPanel.every((block) => !block.includes("100dvh"))).toBe(true);
    expect(embeddedDialog).toContain("max-height: 100%");
  });

  it("uses one bounded scroll body between fixed AI dialog chrome", () => {
    const dialogBlocks = cssBlocks(".ai-situation-dialog,\n.ai-agent-dialog");
    const bodyBlock = cssBlock(".ai-dialog-body");

    expect(dialogBlocks.some((block) => block.includes("grid-template-rows: auto minmax(0, 1fr) auto"))).toBe(true);
    expect(bodyBlock).toContain("min-height: 0");
    expect(bodyBlock).toContain("overflow-y: auto");
    expect(bodyBlock).toContain("overscroll-behavior: contain");
  });

  it("bounds mobile information content below its safe-area navigation", () => {
    const panelBlocks = cssBlocks(".info-panel");
    const contentBlock = cssBlock(".info-content");
    const backdropBlocks = cssBlocks(".dialog-backdrop,\n  .preview-backdrop,\n  .info-backdrop,\n  .mute-backdrop");

    expect(panelBlocks.some((block) => block.includes("grid-template-rows: auto minmax(0, 1fr)"))).toBe(true);
    expect(panelBlocks.some((block) => block.includes("height: 100%"))).toBe(true);
    expect(contentBlock).toContain("min-height: 0");
    expect(contentBlock).toContain("overflow-y: auto");
    expect(backdropBlocks.some((block) => block.includes("env(safe-area-inset-top, 0px)"))).toBe(true);
    expect(backdropBlocks.some((block) => block.includes("env(safe-area-inset-bottom, 0px)"))).toBe(true);
  });

  it("applies safe-area overlay bounds before the mobile breakpoint so iPads are covered", () => {
    const baseBackdrop = cssBlock(".dialog-backdrop,\n.preview-backdrop,\n.info-backdrop,\n.mute-backdrop");
    const baseInfoPanel = cssBlock(".info-panel");

    expect(baseBackdrop).toContain("env(safe-area-inset-top, 0px)");
    expect(baseBackdrop).toContain("env(safe-area-inset-bottom, 0px)");
    expect(baseInfoPanel).toContain("height: 100%");
    expect(baseInfoPanel).not.toContain("100dvh");
  });

  it("keeps member avatars square instead of stretching them as row copy", () => {
    const avatarBlock = cssBlock(".member-row > .avatar");
    const copyBlock = cssBlock(".member-row-copy");

    expect(avatarBlock).toContain("width: 34px");
    expect(avatarBlock).toContain("height: 34px");
    expect(avatarBlock).toContain("flex: 0 0 34px");
    expect(avatarBlock).toContain("aspect-ratio: 1");
    expect(copyBlock).toContain("flex: 1 1 auto");
    expect(styles).not.toContain(".member-row span {");
  });

  it("keeps mobile location tools under plus and the jump action inside the message field", () => {
    const toolsBlock = cssBlock(".composer-tools-popover");
    const jumpBlock = cssBlock(".composer-jump-latest");
    const embeddedComposer = cssBlock(".wa-shell.embedded .composer");

    expect(toolsBlock).toContain("position: absolute");
    expect(toolsBlock).toContain("bottom: calc(100% + 9px)");
    expect(jumpBlock).toContain("flex: 0 0 34px");
    expect(embeddedComposer).toContain("padding-bottom: 8px");
    expect(styles).not.toContain(".composer-location-quickbar");
    expect(styles).not.toContain(".jump-latest {");
  });

  it("uses compact stacked tabs and a smaller hero in the mobile contact panel", () => {
    const navButtonBlocks = cssBlocks(".info-nav > button");
    const heroAvatarBlocks = cssBlocks(".info-hero .avatar");
    const contactSection = cssBlock(".contact-info-section");

    expect(navButtonBlocks.some((block) => block.includes("flex-direction: column"))).toBe(true);
    expect(heroAvatarBlocks.some((block) => block.includes("width: 56px"))).toBe(true);
    expect(contactSection).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("keeps the composer shrinkable and dialog actions touch sized on compact phones", () => {
    expect(cssBlocks(".message-input").some((block) => block.includes("min-width: 0"))).toBe(true);
    expect(cssBlocks(".composer-row").some((block) => block.includes("min-width: 0"))).toBe(true);
    expect(
      cssBlocks(
        ".dialog-tabs button,\n  .primary-dialog-action,\n  .secondary-dialog-action,\n  .secondary-danger-action"
      ).some((block) => block.includes("min-height: 44px"))
    ).toBe(true);
  });

  it("stacks contact metrics and AI evidence for 320px phones", () => {
    const compactColumns = cssBlocks(".contact-info-section,\n  .ai-situation-meta");
    const evidenceRows = cssBlocks(".ai-evidence-group li");

    expect(compactColumns.some((block) => block.includes("grid-template-columns: 1fr"))).toBe(true);
    expect(evidenceRows.some((block) => block.includes("grid-template-columns: auto minmax(0, 1fr)"))).toBe(true);
  });

  it("uses one-column action rows for compact recovery and AI dialogs", () => {
    const footers = cssBlocks(".recovery-dialog footer,\n  .ai-situation-dialog footer,\n  .ai-agent-dialog footer");
    const footerButtons = cssBlocks(
      ".recovery-dialog footer button,\n  .ai-situation-dialog footer button,\n  .ai-agent-dialog footer button,\n  .ai-situation-dialog footer .primary-dialog-action,\n  .ai-agent-dialog footer .primary-dialog-action"
    );

    expect(footers.some((block) => block.includes("grid-template-columns: 1fr"))).toBe(true);
    expect(footerButtons.some((block) => block.includes("width: 100%"))).toBe(true);
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
