// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MediaPreviewDialog from "./MediaPreviewDialog";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MediaPreviewDialog", () => {
  it("renders a document preview with metadata and close action", async () => {
    const onClose = vi.fn();
    render(
      <MediaPreviewDialog
        item={{
          byteSizeLabel: "128 KB",
          contentType: "application/pdf",
          downloadName: "manual.pdf",
          kind: "document",
          title: "manual.pdf",
          url: "blob:https://cop.zeleznalady.cz/manual"
        }}
        onClose={onClose}
      />
    );

    expect(screen.getByRole("dialog", { name: "Náhled manual.pdf" })).toBeTruthy();
    expect(screen.getByText(/Dokument/u)).toBeTruthy();
    expect(screen.getByText(/application\/pdf/u)).toBeTruthy();
    expect(screen.getByText(/128 KB/u)).toBeTruthy();
    expect(await screen.findByTitle("manual.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Zavřít" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("posts a map center request from a location preview", () => {
    const postMessage = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage } });
    try {
      render(
        <MediaPreviewDialog
          item={{
            caption: "Poloha z mapy",
            kind: "location",
            location: { lat: 50.12951, lon: 17.36297, source: "map" },
            title: "Moje poloha"
          }}
          onClose={vi.fn()}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Vycentrovat mapu/u }));
    } finally {
      Object.defineProperty(window, "parent", { configurable: true, value: originalParent });
    }

    expect(postMessage).toHaveBeenCalledWith(
      { lat: 50.12951, lon: 17.36297, type: "cop-chat:center-location", zoom: 16 },
      window.location.origin
    );
  });
});
