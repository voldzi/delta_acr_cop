import { useEffect, useState } from "react";
import { beginLogin, forgetLocalAuthSession, initializeAuth, readAuthConfig, type AuthSession } from "./auth";
import {
  confirmDeletion,
  deletionAvailable,
  DeletionRequestError,
  prepareDeletion,
  readDeletionReceipt,
  type DeletionPreflight,
  type DeletionReceipt
} from "./account-deletion-api";
import "./account-deletion.css";

const trackingKey = "cop-account-erasure-operation-v1";
const domainNames: Record<string, string> = {
  keycloak: "Přihlášení",
  cop_sessions_profiles: "Profil",
  cop_devices: "Zařízení",
  messaging_matrix: "Zprávy",
  voice_livekit: "Hovory",
  cop_content_media: "Příspěvky a přílohy",
  mobility_dispatch: "Vozidla a skupiny",
  sim_measurements: "Dopravní měření",
  ai_router: "AI klíč a související údaje",
  moderation_audit: "Hlášení",
  backup_restore: "Zálohy a obnova"
};
function storedOperation(): string | undefined {
  try {
    const value = sessionStorage.getItem(trackingKey);
    return value && /^[0-9a-f-]{36}$/iu.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
function saveOperation(value?: string) {
  try {
    if (value) sessionStorage.setItem(trackingKey, value);
    else sessionStorage.removeItem(trackingKey);
  } catch {
    /* The server cookie still permits receipt recovery in this tab. */
  }
}
export default function AccountDeletionPage() {
  const [session, setSession] = useState<AuthSession>(),
    [available, setAvailable] = useState<boolean>(),
    [plan, setPlan] = useState<DeletionPreflight>();
  const [tracking, setTracking] = useState(storedOperation),
    [receipt, setReceipt] = useState<DeletionReceipt>();
  const [busy, setBusy] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<string>(),
    [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (tracking) return;
    let live = true;
    void initializeAuth(readAuthConfig())
      .then(async (current) => {
        if (!live) return;
        setSession(current);
        if (current.status === "authenticated") setAvailable(await deletionAvailable(current));
      })
      .catch(() => {
        if (live) setError("Dostupnost odstranění účtu nyní nelze ověřit. Zkuste to znovu později.");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [tracking]);
  useEffect(() => {
    if (!tracking) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>,
      attempt = 0;
    const poll = async () => {
      try {
        const current = await readDeletionReceipt(tracking);
        if (!live) return;
        setReceipt(current);
        setError(undefined);
        setBusy(false);
        forgetLocalAuthSession();
        if (current.accountDeleted) {
          saveOperation();
          return;
        }
      } catch (cause) {
        if (!live) return;
        setBusy(false);
        if (cause instanceof DeletionRequestError && (cause.status === 401 || cause.status === 404)) {
          setError(
            "Potvrzení o mazání není dostupné v této relaci. Účet nepovažujeme za odstraněný. Obnovte ověření účtu nebo kontaktujte podporu."
          );
          return;
        }
        setError(
          "Stav mazání nyní nelze načíst. Obnovení spojení jej znovu ověří; účet zatím nepovažujeme za odstraněný."
        );
      }
      if (live)
        timer = setTimeout(
          () => {
            void poll();
          },
          Math.min(30_000, 5_000 * 2 ** Math.min(attempt++, 3))
        );
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [tracking]);
  const failure = (cause: unknown) => {
    const needsFresh = cause instanceof DeletionRequestError && cause.code === "FRESH_AUTH_REQUIRED";
    setFresh(needsFresh);
    setError(
      needsFresh
        ? "Pro odstranění účtu je potřeba nové přihlášení."
        : "Odstranění nyní nelze potvrdit. Nic nepovažujeme za smazané; znovu zkontrolujte podmínky."
    );
  };
  const prepare = async () => {
    if (!session) return;
    setBusy(true);
    setError(undefined);
    setConfirmed(false);
    setPlan(undefined);
    try {
      setPlan(await prepareDeletion(session, crypto.randomUUID()));
    } catch (cause) {
      failure(cause);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!session || !plan || !confirmed) return;
    setBusy(true);
    setError(undefined);
    saveOperation(plan.operationId);
    try {
      const current = await confirmDeletion(session, plan);
      setReceipt(current);
      setTracking(plan.operationId);
      forgetLocalAuthSession();
    } catch (cause) {
      // A lost response may follow an accepted fence. Recover through its exact
      // cookie-bound receipt before offering any new destructive operation.
      try {
        const current = await readDeletionReceipt(plan.operationId);
        setReceipt(current);
        setTracking(plan.operationId);
        forgetLocalAuthSession();
      } catch {
        // The first request can still be completing after a network timeout.
        // Keep its operation for recovery instead of silently losing it or
        // issuing another destructive request after an early 404.
        setTracking(plan.operationId);
        failure(cause);
      }
    } finally {
      setBusy(false);
    }
  };
  const login = () => {
    void beginLogin(readAuthConfig(), { prompt: "login" }).catch(() => setError("Přihlášení se nepodařilo otevřít."));
  };
  return (
    <main className="account-deletion-page">
      <section aria-labelledby="deletion-title">
        <a href="/">Zpět do COP</a>
        <h1 id="deletion-title">Odstranění celého účtu</h1>
        <p>
          Odstranění účtu COP je nevratné a ukončí přístup do COP, COP Mobile a Jízdy. Společné přihlášení a přístup do
          SIM zůstanou zachovány.
        </p>
        {receipt ? (
          <div role="status" aria-live="polite">
            <h2>{receipt.accountDeleted ? "Účet byl odstraněn" : "Odstranění probíhá"}</h2>
            <p>
              {receipt.accountDeleted
                ? "Všechny služby potvrdily dokončení."
                : "Přístup účtu je zablokovaný. Čekáme na skutečné dokončení zbývajících částí:"}
            </p>
            {!receipt.accountDeleted && (
              <ul>
                {receipt.remaining.map((domain) => (
                  <li key={domain}>{domainNames[domain]}</li>
                ))}
              </ul>
            )}
            <p className="deletion-operation">Číslo požadavku: {receipt.operationId}</p>
          </div>
        ) : tracking ? (
          <p role="status">Ověřuji stav již zahájeného požadavku…</p>
        ) : busy ? (
          <p role="status">Ověřuji dostupnost…</p>
        ) : session?.status !== "authenticated" ? (
          <button type="button" onClick={login}>
            Přihlásit se pro ověření účtu
          </button>
        ) : (
          <>
            <p>
              Přihlášený účet: <strong>{session.profile?.name ?? session.profile?.username ?? "COP"}</strong>
            </p>
            {available === false ? (
              <p>Odstranění celého účtu zatím není dostupné. Požadavek jsme nezahájili.</p>
            ) : (
              available === true && (
                <>
                  <p>
                    Vaše příspěvky a osobní vazby budou odstraněny. Záznamy ostatních lidí zůstanou. Vlastněná sdílená
                    vozidla nejprve převeďte na jiného oprávněného člena; vlastnictví skupin je třeba vyřešit předem.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void prepare();
                    }}
                  >
                    Zkontrolovat podmínky odstranění
                  </button>
                  {plan?.canConfirm === false && (
                    <div role="status">
                      <h2>Nejdříve je třeba vyřešit</h2>
                      <ul>
                        {plan.blockers.map(({ domain, reason }) => (
                          <li key={domain}>
                            {domainNames[domain]}:{" "}
                            {reason === "ownership_unresolved" || reason === "choice_required"
                              ? "nevyřešené vlastnictví nebo původ údajů"
                              : "služba není připravena"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {plan?.canConfirm && (
                    <div className="deletion-confirm">
                      <label>
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(event) => setConfirmed(event.target.checked)}
                        />{" "}
                        Rozumím, že nevratně odstraním účet COP/Jízdy a své příspěvky. Přihlášení do SIM zůstane
                        zachováno.
                      </label>
                      <button
                        type="button"
                        disabled={!confirmed || busy}
                        onClick={() => {
                          void confirm();
                        }}
                      >
                        Trvale odstranit celý účet
                      </button>
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        {fresh && !tracking && (
          <button type="button" onClick={login}>
            Znovu ověřit přihlášení
          </button>
        )}
        {tracking && !receipt && (
          <button type="button" onClick={() => window.location.reload()}>
            Znovu ověřit stav
          </button>
        )}
        <p>
          Podpora: <a href="mailto:podpora@zeleznalady.cz">podpora@zeleznalady.cz</a>
        </p>
      </section>
    </main>
  );
}
