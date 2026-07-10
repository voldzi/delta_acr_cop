// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommunityAttachmentPicker, CommunityContactPicker, mergeCommunityReportFiles } from "./main";

describe("community report contact picker", () => {
  it("searches the COP directory and stores canonical subject ids", async () => {
    const onChange = vi.fn();
    const onSearch = vi.fn(async () => [
      {
        displayName: "Daniel Bambušek",
        subjectId: "subject-daniel",
        username: "daniel"
      }
    ]);
    render(<CommunityContactPicker disabled={false} selectedSubjectIds={[]} onChange={onChange} onSearch={onSearch} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Vyhledat kontakt" }), {
      target: { value: "Daniel" }
    });
    const result = await screen.findByRole("option", { name: "Vybrat kontakt Daniel Bambušek" });
    fireEvent.click(result);

    expect(onSearch).toHaveBeenCalledWith("Daniel");
    expect(onChange).toHaveBeenCalledWith(["subject-daniel"]);
  });

  it("renders selected people as removable contact chips", () => {
    const onChange = vi.fn();
    render(
      <CommunityContactPicker
        disabled={false}
        selectedSubjectIds={["subject-daniel"]}
        onChange={onChange}
        onSearch={vi.fn(async () => [])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Odebrat kontakt subject-daniel" }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe("community report attachment picker", () => {
  it("accepts mobile files and exposes an explicit remove action", async () => {
    const file = new File(["photo"], "zasah.jpg", { lastModified: 123, type: "image/jpeg" });
    const onFilesSelected = vi.fn();
    const onRemoveFile = vi.fn();
    const view = render(
      <CommunityAttachmentPicker
        disabled={false}
        files={[]}
        onFilesSelected={onFilesSelected}
        onRemoveFile={onRemoveFile}
      />
    );

    fireEvent.change(screen.getByLabelText("Vybrat fotografie nebo soubory"), { target: { files: [file] } });
    expect(onFilesSelected).toHaveBeenCalledWith([file]);

    view.rerender(
      <CommunityAttachmentPicker
        disabled={false}
        files={[file]}
        onFilesSelected={onFilesSelected}
        onRemoveFile={onRemoveFile}
      />
    );
    expect(screen.getByText("zasah.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Odebrat přílohu zasah.jpg" }));

    await waitFor(() => expect(onRemoveFile).toHaveBeenCalledWith(0));
  });

  it("merges repeated selections without duplicating the same file", () => {
    const first = new File(["a"], "a.pdf", { lastModified: 1, type: "application/pdf" });
    const second = new File(["b"], "b.pdf", { lastModified: 2, type: "application/pdf" });

    expect(mergeCommunityReportFiles([first], [first, second])).toEqual([first, second]);
  });
});
