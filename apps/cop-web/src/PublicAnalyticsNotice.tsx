/** Owner-approved shared wording (VCode 0527093); shown with analytics activation. */
export function PublicAnalyticsNotice() {
  if (import.meta.env.VITE_COP_PUBLIC_ANALYTICS_ENABLED !== "true") return null;
  return (
    <details className="public-flood-demo-analytics-notice">
      <summary>Měření návštěvnosti veřejné ukázky · Privacy information</summary>
      <div lang="cs">
        <a href="/analytics/privacy-cs.html">Český doplněk soukromí</a>
        <p>
          Na veřejné syntetické povodňové ukázce COP měříme zobrazení této stránky, abychom poznali její využití. Hlavní
          situační mapu, přihlášené pracovní části a chat tímto měřením nesledujeme.
        </p>
        <p>
          Měření používá společnou službu VCode/Umami v naší infrastruktuře bez analytických cookies a bez záznamu
          obrazovky. Zaznamenává pouze otevření předem vybraných veřejných stránek. Nesledujeme kliknutí, neodesíláme
          obsah formulářů, údaje o účtu, rezervace, polohu, zprávy, zdravotní údaje, odpovědi ani herní postup.
          Nepředáváme parametry adres, fragmenty, názvy stránek ani odkazující stránku a nespojujeme statistiky s vaším
          účtem.
        </p>
        <p>
          Při přijetí požadavku služba dočasně zpracuje síťovou adresu zařízení a údaje prohlížeče pro denně obměňované
          technické označení návštěv. IP adresu neukládá v čitelné podobě do analytické databáze. Souhrn obsahuje také
          obecnou kategorii prohlížeče, operačního systému a zařízení; celé síťové hlavičky ani odvozenou geografickou
          polohu neukládáme. Odhad návštěvníků není přesným počtem konkrétních lidí. Statistiky nejsou veřejné a přístup
          k nim mají jen oprávnění správci. Analytické záznamy včetně jejich záloh uchováváme nejvýše 180 dní.
        </p>
        <p>
          Respektujeme Do Not Track a Global Privacy Control: při jejich zapnutí návštěvu neodešleme. Události bez
          připojení zahazujeme a neukládáme k pozdějšímu odeslání. Toto měření je oddělené od případných dosavadních
          produktových či herních statistik a nepředává do společné služby jejich údaje.
        </p>
      </div>
      <div lang="en">
        <a href="/analytics/privacy-en.html">English privacy supplement</a>
        <p>
          We measure pageviews of COP's public synthetic flood demonstration to understand its use. This measurement
          excludes the main situation map, authenticated workspaces and chat.
        </p>
        <p>
          Measurement uses the shared VCode/Umami service within our infrastructure without analytics cookies or screen
          recording. It records only views of selected public pages. We do not track clicks or send form contents,
          account information, bookings, location, messages, health data, answers or game progress. URL parameters,
          fragments, page titles and referring pages are not sent, and statistics are not linked to your account.
        </p>
        <p>
          When a request arrives, the service temporarily processes the device's network address and browser information
          to derive a daily changing technical visit identifier. IP addresses are not stored in readable form in the
          analytics database. Summaries also retain general browser, operating system and device categories; full
          network headers and inferred geographic location are not stored. Estimated visitors are not an exact count of
          individuals. Statistics are private and available only to authorized administrators. Analytics records,
          including their backups, are retained for no more than 180 days.
        </p>
        <p>
          We respect Do Not Track and Global Privacy Control: when enabled, no visit is sent. Offline events are
          discarded rather than stored for later transmission. This measurement is separate from any existing product or
          game statistics and does not forward their data to the shared service.
        </p>
      </div>
    </details>
  );
}
