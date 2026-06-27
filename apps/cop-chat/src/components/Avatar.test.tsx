// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar, initialsFor } from "./Avatar";

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
});
