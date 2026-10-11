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
          obrazovky. Zaznamenává otevření předem vybraných veřejných stránek, obecný zdroj příchodu z vybraných
          veřejných služeb a kliknutí na určené veřejné odkazy do App Storu, na kontakt nebo mimo web. Neposíláme
          původní ani cílové adresy odkazů, parametry adres, fragmenty, názvy stránek či obsah odkazů. Nesledujeme obsah
          formulářů, údaje o účtu, rezervace, polohu, zprávy, zdravotní údaje, odpovědi ani herní postup a nespojujeme
          statistiky s vaším účtem. Kliknutí neznamená instalaci, rezervaci ani odeslání zprávy.
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
          recording. It records views of selected public pages, general traffic sources from selected public services,
          and clicks on designated public links to the App Store, contact options or external websites. We do not send
          original or destination link addresses, URL parameters, fragments, page titles or link contents. We do not
          track form contents, account information, bookings, location, messages, health data, answers or game progress,
          and statistics are not linked to your account. A click does not mean an installation, booking or sent message.
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
