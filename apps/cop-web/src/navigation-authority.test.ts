import { describe, expect, it } from "vitest";
import { createNavigationAuthority } from "./navigation-authority";

describe("navigation authority", () => {
  it("lets only the latest asynchronous intent move the camera", () => {
    const authority = createNavigationAuthority();
    const restore = authority.claim("restore");
    const selection = authority.claim("selection");

    expect(authority.isCurrent(restore)).toBe(false);
    expect(authority.isCurrent(selection)).toBe(true);
  });

  it("lets direct manipulation supersede automatic movement", () => {
    const authority = createNavigationAuthority();
    const automatic = authority.claim("automatic");
    const user = authority.claim("user");

    expect(authority.isCurrent(automatic)).toBe(false);
    expect(authority.current()).toEqual(user);
  });
});
