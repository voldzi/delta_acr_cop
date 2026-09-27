# ADR 0031: Uživatelský API klíč pro jeden COP chat (příprava)

## Stav

Připravena pouze správa klíče, bez přepnutí směrování produkčního chatu.
Příznak `COP_AI_CHAT_BYOK_ENABLED` je ve výchozím stavu vypnutý.

## Rozhodnutí

COP nabídne přihlášenému uživateli vložení a odebrání vlastního OpenAI API klíče
v existujícím rozhraní AI chatu. Klíč pošle přes COP API internímu SIM AI Routeru.
COP jej neuloží do uživatelského profilu, historie, auditu ani odpovědi API.
Router musí klíč ověřit, zašifrovat, uchovat odděleně podle neprůhledného
stabilního `userId` a umožnit jeho odstranění. Stavové API smí vracet pouze
`configured`, `available` a `provider`.

Získání klíče nezakládá oprávnění odeslat do externího modelu celý dosavadní
COP kontext. Současný chat sestavuje i dešifrované zprávy, nepřijatá komunitní
hlášení a detailní incidenty. Jsou interní, dokud konkrétní zdroj nemá ověřenou
publikační klasifikaci. Uživatelův klíč také nepřevádí odpovědnost COP za
automaticky přidaný kontext na uživatele.

## Navržený kontrakt SIM

Autentizace všech volání: existující dedikovaný službový token COP. `userId` je
stejný HMAC pseudonym jako u `cop_chat`; Router nesmí přijmout identitu z
prohlížeče. Tyto interní endpointy zatím SIM musí doplnit:

| Endpoint | Požadavek | Odpověď |
| --- | --- | --- |
| `POST /api/v1/ai-router/cop-chat-credentials/status` | `{userId, provider:"openai"}` | `{configured:boolean, provider:"openai"}` |
| `POST /api/v1/ai-router/cop-chat-credentials/register` | `{userId, provider:"openai", apiKey}` | `{configured:true, provider:"openai"}` |
| `POST /api/v1/ai-router/cop-chat-credentials/remove` | `{userId, provider:"openai"}` | `{configured:false, provider:"openai"}` |

Router nesmí vracet klíč v žádné odpovědi, logu ani auditu. Klíč validuje bez
generování odpovědi, ukládá šifrovaně s rotovatelným šifrovacím klíčem,
odděluje jej od služby COP a po odebrání jej přestane používat. Chyby validace
musí být odlišitelné od výpadku Routeru bez odhalení klíče.

## Podmínky pro směrování

SIM musí samostatně zavést verzi kontraktu `cop_chat` s `billingSource` pevně
určeným podle přihlášeného `userId`, nikoli z klientského pole. Pro veřejnou
bezplatnou aplikaci je výchozí `user_credential`; chybějící nebo neplatný klíč
znamená srozumitelnou chybu, nikdy přepnutí na účet COP. Router dál vynucuje
model, limity, audit tokenů a nákladů, výpadky a zákaz přímého fallbacku.

COP a SIM před aktivací společně určí, které uživatelovy otázky a které
konkrétní typované COP podklady lze externě zpracovat. Veřejné výstrahy a
publikované agregace mohou být kandidáty; dešifrované zprávy, interní incidenty
a nepřijatá hlášení nesmějí být automaticky označena jako veřejná. Pro IZS
vznikne role a auditovaný přístup k souhrnům podle oprávnění, nikoli plošné
zveřejnění původních záznamů.

Před produkčním přepnutím je třeba dodat závazné OpenAPI v SIM, otestovat
izolaci více uživatelů a klíčů, odmítnutí neplatných dat, limity a výpadky,
spotřebu účtovanou správnému projektu a rollback. Režim Global/EU se musí
uživateli pravdivě zobrazit podle projektu poskytovatele; COP jej nemůže
odvodit pouze ze zadaného klíče.
