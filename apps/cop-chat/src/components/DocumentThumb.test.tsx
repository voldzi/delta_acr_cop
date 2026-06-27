// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentThumb } from "./DocumentThumb";

describe("DocumentThumb", () => {
  it("uses a short uppercase file extension", () => {
    render(<DocumentThumb fileName="situacni-zprava.pdf" />);
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("falls back to FILE when the name has no extension", () => {
    render(<DocumentThumb fileName="priloha" />);
    expect(screen.getByText("FILE")).toBeTruthy();
  });
});
