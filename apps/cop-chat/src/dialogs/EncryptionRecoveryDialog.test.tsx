// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EncryptionRecoveryDialog from "./EncryptionRecoveryDialog";

describe("EncryptionRecoveryDialog", () => {
  it("shows a generated recovery key and gives visible copy feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <EncryptionRecoveryDialog
        generatedRecoveryKey="COP-RECOVERY-KEY"
        recoveryKeyInput=""
        saving={false}
        status={{
          canPrepareForMobile: true,
          crossSigningReady: true,
          keyBackupEnabled: true,
          keyBackupExists: true,
          matrixRustCompatible: true,
          needsRecovery: false,
          needsSetup: false,
          ready: true,
          secretStorageReady: true,
          supported: true
        }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onPrepareMobile={vi.fn()}
        onRecoveryKeyInputChange={vi.fn()}
        onReset={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Zkopírovat obnovovací klíč" }));

    expect(writeText).toHaveBeenCalledWith("COP-RECOVERY-KEY");
    await waitFor(() => expect(screen.getByText("Klíč je zkopírovaný do schránky.")).toBeTruthy());
  });

  it("lets an existing backup be restored from a recovery key", () => {
    const onRestore = vi.fn();
    const onRecoveryKeyInputChange = vi.fn();
    render(
      <EncryptionRecoveryDialog
        generatedRecoveryKey={null}
        recoveryKeyInput="SECRET"
        saving={false}
        status={{
          canPrepareForMobile: false,
          crossSigningReady: true,
          keyBackupEnabled: false,
          keyBackupExists: true,
          matrixRustCompatible: false,
          needsRecovery: true,
          needsSetup: false,
          ready: false,
          secretStorageReady: true,
          supported: true
        }}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onPrepareMobile={vi.fn()}
        onRecoveryKeyInputChange={onRecoveryKeyInputChange}
        onReset={vi.fn()}
        onRestore={onRestore}
      />
    );

    fireEvent.change(screen.getByLabelText("Obnovovací klíč"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Obnovit zařízení/u }));

    expect(onRecoveryKeyInputChange).toHaveBeenCalledWith("NEW");
    expect(onRestore).toHaveBeenCalled();
  });
});
