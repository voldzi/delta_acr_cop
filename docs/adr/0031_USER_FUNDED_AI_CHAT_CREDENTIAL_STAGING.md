# ADR 0031: Vlastní OpenAI klíč v jediném chatu COP

## Stav

Adaptér COP odpovídá kontraktu SIM `cop-chat-byok-v1` z větve
`codex/cop-chat-full-router` (ověřený commit `f660647`). Produkční přepnutí
chatu není součástí tohoto rozhodnutí. Správa klíče i směrování mají oddělené
výchozí vypnuté přepínače `COP_AI_CHAT_BYOK_ENABLED` a
`COP_AI_CHAT_BYOK_ROUTING_ENABLED`.

## Rozhodnutí

COP API odvodí stabilní HMAC pseudonym výhradně z přihlášené identity, vydá
na 60 sekund tvrzení `x-cop-actor` s přesně `sub`, `aud`, `iat`, `exp` a
podepíše je odděleným tajemstvím `COP_AI_ROUTER_ACTOR_SECRET` v
`x-cop-actor-signature`. Prohlížeč neurčuje totožnost, plátce, klíč ani model.
Službový token a actor tajemství existují pouze v produkčních secrets.

Jediný chat může při pozdějším zapnutí směrování použít výhradně
`POST /api/v1/ai-router/cop/chat` s `contractVersion=cop-chat-byok-v1`,
`billingSource=user_openai_key`, `allowExternal=true` a přesně uživatelem
napsanou otázkou. Nepřipojuje historii, dešifrované zprávy, nezveřejněná
hlášení ani volný kontext. Automatický kontext se v této verzi neposílá,
protože COP zatím nemá důkaz publikace, původu a platnosti pro takové položky.
Pokus předat `automaticContext` je odmítnut. SIM Router vynucuje model,
uživatelské limity a účtování. Chyba, chybějící klíč a výpadek nesmějí
spustit společný klíč ani přímé OpenAI volání.

Správa vlastního klíče používá `GET/PUT/DELETE
/api/v1/ai-router/cop/users/me/openai-key`. COP jej pouze jednorázově
předá Routeru a neukládá ani neloguje. GET nevrací klíč; DELETE znamená
logické odstranění v Routeru, nikoli odvolání u OpenAI nebo výmaz starých
záloh. UI upozorňuje na uložení v Routeru, vlastní účtování a zpracování
OpenAI Global. Volba modelu v UI je při této trase skrytá a server ji
ignoruje.

## Aktivace a návrat

Nejprve ověřit tajemství, dostupnost Routeru, dva oddělené projekty OpenAI,
izolaci identit, účtovací přehled SIM, limity, 429, výpadek, obsah odchozího
požadavku a obnovený lokální model. Správce pak může odděleně zapnout správu
klíče a po společné akceptaci nový chat. Pro rollback vypnout
`COP_AI_CHAT_BYOK_ROUTING_ENABLED`; dosavadní chatová cesta zůstává v kódu.
Nikdy nepřepínat na sdílený externí účet jako automatický fallback.
