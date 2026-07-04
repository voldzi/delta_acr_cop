// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar, initialsFor } from "./Avatar";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Avatar", () => {
  it("creates stable Czech initials from display names", () => {
    expect(initialsFor("Jiří Volek")).toBe("JV");
    expect(initialsFor("operator")).toBe("OP");
    expect(initialsFor("")).toBe("");
  });

  it("renders initials when no image is available", () => {
    render(<Avatar label="COP Operator" />);
    expect(screen.getByText("CO")).toBeTruthy();
  });

  it("renders the default AI assistant avatar", () => {
    render(<Avatar label="COP AI Assistant" variant="ai" />);
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("fetches Matrix media avatars with the Matrix access token", async () => {
    const src = "https://msg.zeleznalady.cz/_matrix/client/v1/media/download/docker.home.cz/avatar-id";
    const createObjectURL = vi.fn(() => "blob:matrix-avatar");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const avatarBlob = new Blob(["avatar"], { type: "image/png" });
    const fetchMock = vi.fn(async () => ({
      blob: async () => avatarBlob,
      ok: true,
      status: 200
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Avatar label="COP Operator" mediaAccessToken="matrix-token" src={src} />);

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(avatarBlob));
    expect(fetchMock).toHaveBeenCalledWith(src, expect.objectContaining({
      credentials: "omit",
      headers: {
        Authorization: "Bearer matrix-token"
      }
    }));
  });
});
