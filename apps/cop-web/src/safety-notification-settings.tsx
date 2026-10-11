import React from "react";

export interface SafetyNotificationConsent {
  contractVersion: "cop-safety-notification-consent-v1";
  enabled: boolean;
  updatedAt: string;
}

export async function setSafetyNotificationConsent(
  apiBase: string,
  token: string,
  enabled: boolean,
  signal?: AbortSignal
): Promise<SafetyNotificationConsent> {
  const response = await fetch(`${apiBase}/api/v1/me/notifications/safety`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
    signal
  });
  if (!response.ok) throw new Error("Nastavení upozornění se nepodařilo uložit. Zkuste to znovu.");
  const value = (await response.json()) as Partial<SafetyNotificationConsent>;
  if (
    value.contractVersion !== "cop-safety-notification-consent-v1" ||
    value.enabled !== enabled ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new Error("Server nepotvrdil změnu nastavení upozornění.");
  }
  return value as SafetyNotificationConsent;
}

export function SafetyNotificationSettings({
  authenticated,
  enabled,
  deviceRegistered,
  watchedAreaCount,
  saving,
  profileReady,
  error,
  onChange,
  onRegisterDevice
}: {
  authenticated: boolean;
  enabled: boolean;
  deviceRegistered: boolean;
  watchedAreaCount: number;
  saving: boolean;
  profileReady: boolean;
  error: string | null;
  onChange: (enabled: boolean) => void;
  onRegisterDevice: () => void;
}) {
  const canEnable = authenticated && profileReady && deviceRegistered && watchedAreaCount > 0;
  return (
    <div className="settings-subsection safety-notification-settings">
      <h3>Upozornění pro sledované zóny</h3>
      <p className="settings-help">
        Po výslovném zapnutí vám COP může posílat běžná oznámení o aktuálních oficiálních výstrahách v uložených
        sledovaných zónách, i když aplikace není otevřená. Doručení závisí na zařízení a jeho nastavení. Zpravodajské
        články ani neověřené polohy tato upozornění nespouštějí.
      </p>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving || (!enabled && !canEnable) || !authenticated}
          onChange={(event) => onChange(event.target.checked)}
        />
        Povolit automatická upozornění pro mé zóny
      </label>
      <p className="settings-help" role="status">
        {saving
          ? "Ukládám změnu…"
          : enabled
            ? "Souhlas je uložený. Lze jej kdykoliv odvolat vypnutím této volby."
            : "Automatická upozornění jsou vypnutá."}
      </p>
      {!authenticated ? <p className="empty-mini">Pro zapnutí se přihlaste ke svému účtu.</p> : null}
      {authenticated && watchedAreaCount === 0 ? (
        <p className="empty-mini">
          Nejprve přidejte a zapněte sledovanou zónu. Poloha telefonu se automaticky neukládá.
        </p>
      ) : null}
      {authenticated && !deviceRegistered ? (
        <div className="settings-button-row">
          <button className="primary-button secondary" type="button" disabled={saving} onClick={onRegisterDevice}>
            Povolit oznámení na tomto zařízení
          </button>
          <p className="settings-help">Zařízení zatím nemá potvrzenou registraci pro doručení.</p>
        </div>
      ) : null}
      {enabled && (!deviceRegistered || watchedAreaCount === 0) ? (
        <p className="empty-mini">
          Souhlas je uložený, ale doručení vyžaduje aktivní sledovanou zónu a registrované zařízení.
        </p>
      ) : null}
      {error ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
