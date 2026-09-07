// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommunityReportDialog,
  createCommunityReportDraft,
  validateCommunityReportDraft,
  type CommunityReportDraft
} from "./main";

afterEach(cleanup);

describe("community report publication safeguards", () => {
  it("requires explicit event-location and publication confirmation even with valid fallback coordinates", () => {
    const draft = { ...createCommunityReportDraft(), title: "Spadlý strom" };
    expect(validateCommunityReportDraft(draft)).toContain("Potvrďte místo");
    expect(validateCommunityReportDraft({ ...draft, locationConfirmed: true })).toBeNull();
    expect(
      validateCommunityReportDraft({
        ...draft,
        locationConfirmed: true,
        location: { lat: 91, lon: 15, source: "manual" }
      })
    ).toContain("polohu");
  });
  it("requires an edit reason for published reports, but permits retrying an unpublished draft", () => {
    const draft = {
      ...createCommunityReportDraft(),
      title: "Spadlý strom",
      locationConfirmed: true,
      reportId: "draft-1"
    };
    expect(validateCommunityReportDraft(draft)).toBeNull();
    expect(validateCommunityReportDraft({ ...draft, published: true })).toContain("změnilo");
  });
  it("uses media coordinates only after the user chooses them and requires reconfirmation", () => {
    function Harness() {
      const [draft, setDraft] = React.useState<CommunityReportDraft>({
        ...createCommunityReportDraft({ lat: 50, lon: 15, source: "manual" }),
        locationConfirmed: true,
        mediaLocationSuggestion: { fileName: "foto.jpg", location: { lat: 49, lon: 16, source: "photo_exif" } }
      });
      return (
        <>
          <output data-testid="position">
            {draft.location.lat},{draft.location.lon}
          </output>
          <CommunityReportDialog
            apiBase=""
            draft={draft}
            error={null}
            isSubmitting={false}
            success={null}
            uploadProgress={null}
            onChange={setDraft}
            onClose={() => {}}
            onFilesSelected={() => {}}
            onRemoveFile={() => {}}
            onLocationFromMap={() => {}}
            onLocationFromMapClick={() => {}}
            onLocationFromUser={() => {}}
            onSubmit={() => {}}
          />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("position").textContent).toBe("50,15");
    expect(screen.getByRole("button", { name: "Zveřejnit hlášení" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Použít polohu z média" }));
    expect(screen.getByTestId("position").textContent).toBe("49,16");
    expect((screen.getByRole("checkbox", { name: /Potvrzuji místo/ }) as HTMLInputElement).checked).toBe(false);
  });
});
