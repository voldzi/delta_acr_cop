import type { CapabilityAvailability, DeviceCapabilitySnapshot } from "@cop/cop-device-sdk";
import { RefreshCw, Smartphone } from "lucide-react";
import * as React from "react";
import { getCopDevice } from "./cop-device";

const capabilityLabels = {
  location: "Poloha",
  heading: "Kompas",
  attitude: "Natočení telefonu",
  tracking: "Sledování na pozadí",
  media: "Foto a dokumenty",
  shares: "Příjem sdílených souborů",
  notifications: "Nativní notifikace",
  relay: "Device relay"
} as const;

export function DeviceCapabilityPanel(): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<DeviceCapabilitySnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getCopDevice().system.getCapabilities());
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Device API se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="settings-subsection mobile-device-panel">
      <div className="settings-title-row">
        <span className="panel-title">
          <Smartphone size={17} /> Schopnosti tohoto zařízení
        </span>
        <button className="mini-button" disabled={loading} onClick={() => void refresh()} type="button">
          <RefreshCw size={14} />
          Obnovit
        </button>
      </div>
      <p className="settings-help">
        COP zapíná funkce podle skutečně dostupných schopností, nikoli podle typu prohlížeče nebo operačního systému.
      </p>
      {error ? <div className="error-banner">Device API: {error}</div> : null}
      {snapshot ? (
        <>
          <div className="mobile-device-list-header">
            <span>Adapter</span>
            <strong>
              {snapshot.adapter === "native"
                ? "nativní host"
                : snapshot.adapter === "mock"
                  ? "testovací"
                  : "webový prohlížeč"}
            </strong>
          </div>
          <div className="mobile-device-list">
            {Object.entries(capabilityLabels).map(([name, label]) => {
              const capability = snapshot.capabilities[name as keyof typeof capabilityLabels];
              return (
                <div className="mobile-device-row" key={name}>
                  <div>
                    <strong>{label}</strong>
                    {capability.limitations?.[0] ? <small>{capability.limitations[0]}</small> : null}
                  </div>
                  <span className={`mobile-device-status ${capabilityTone(capability.availability)}`}>
                    {capabilityLabel(capability.availability)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : loading ? (
        <div className="empty-mini">Zjišťuji schopnosti zařízení…</div>
      ) : null}
    </div>
  );
}

export function capabilityLabel(availability: CapabilityAvailability): string {
  switch (availability) {
    case "supported":
      return "dostupné";
    case "experimental":
      return "experimentální";
    case "restricted":
      return "omezené";
    case "temporarilyUnavailable":
      return "dočasně nedostupné";
    default:
      return "nedostupné";
  }
}

function capabilityTone(availability: CapabilityAvailability): "ok" | "neutral" | "warn" {
  if (availability === "supported") return "ok";
  if (availability === "experimental" || availability === "restricted" || availability === "temporarilyUnavailable")
    return "warn";
  return "neutral";
}
