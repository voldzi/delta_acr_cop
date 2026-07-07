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
        manualRestore={false}
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
        onManualRestore={vi.fn()}
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
        manualRestore={false}
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
        onManualRestore={vi.fn()}
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

  it("does not force a web reset when key backup is active but iOS metadata are incomplete", () => {
    const onClose = vi.fn();
    const onManualRestore = vi.fn();
    const onPrepareMobile = vi.fn();
    render(
      <EncryptionRecoveryDialog
        generatedRecoveryKey={null}
        manualRestore={false}
        recoveryKeyInput=""
        saving={false}
        status={{
          canPrepareForMobile: true,
          crossSigningReady: false,
          keyBackupEnabled: true,
          keyBackupExists: true,
          matrixRustCompatible: false,
          needsRecovery: false,
          needsSetup: false,
          ready: true,
          secretStorageReady: true,
          supported: true
        }}
        onClose={onClose}
        onCreate={vi.fn()}
        onManualRestore={onManualRestore}
        onPrepareMobile={onPrepareMobile}
        onRecoveryKeyInputChange={vi.fn()}
        onReset={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(screen.getByText(/Web má aktivní E2EE key backup/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Zadat klíč znovu" }));
    expect(onManualRestore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hotovo" }));
    expect(onClose).toHaveBeenCalled();
    expect(onPrepareMobile).not.toHaveBeenCalled();
  });

  it("lets a ready browser enter the recovery key again for undecrypted history", () => {
    const onRestore = vi.fn();
    const onRecoveryKeyInputChange = vi.fn();
    render(
      <EncryptionRecoveryDialog
        generatedRecoveryKey={null}
        manualRestore
        recoveryKeyInput="SECRET"
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
        onManualRestore={vi.fn()}
        onPrepareMobile={vi.fn()}
        onRecoveryKeyInputChange={onRecoveryKeyInputChange}
        onReset={vi.fn()}
        onRestore={onRestore}
      />
    );

    fireEvent.change(screen.getByLabelText("Obnovovací klíč"), { target: { value: "NEW" } });
    fireEvent.click(screen.getByRole("button", { name: /Obnovit klíče/u }));

    expect(onRecoveryKeyInputChange).toHaveBeenCalledWith("NEW");
    expect(onRestore).toHaveBeenCalled();
  });
});
