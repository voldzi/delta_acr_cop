# ADR 0029 (proposal): COP chat through the SIM AI Router

**Status: limited synthetic pilot prepared.** The separate
`/api/v1/ai/chat-agent/reviewed-synthetic` route instantiates the adapter only
when `COP_AI_CHAT_ROUTER_ENABLED=true`. COP supplies fixed fictional facts for
the flood exercise and accepts only a scenario ID and intent from the caller.
The existing `/api/v1/ai/chat-agent/query` route stays on its current provider
and retains its richer context. Public aggregate chat is not active until a
reviewed source-owned numeric producer is available. SIM contract revision
`d2c0cd5` is required. ADR 0028 remains limited to aggregate MCP source health.

## Internal service boundary

Create one dedicated Docker bridge network with `internal: true`. Attach only
`cop-api` and `ai-router-api` to it while preserving their existing default
networks. COP calls `http://ai-router-api:4050` using the dedicated COP bearer
token. The Router exposes port 4050 to that network only, without publishing a
host port. The bridge, Compose changes and container attachments require
explicit approval before any production mutation. Do not join the complete COP
and SIM stacks or alter VPN, VLAN or firewall rules.

The network name is `cop_sim_ai_router_internal`. After approval,
create it as an internal bridge. In COP Compose, assign `cop-api` to both
`default` and this external network. In SIM Compose, assign only
`ai-router-api` to both `default` and this external network. Declare the same
external network by name at the top level of each Compose file. Keep the
current `ports` and `expose` blocks unchanged. Before any service restart,
render both Compose configurations and verify that no other service joined the
new network and that Router port 4050 remains unpublished.

Copy only `AI_ROUTER_COP_TOKEN` from `/srv/sim/.env` into
`COP_AI_ROUTER_TOKEN` in `/srv/cop/.env` on the production host. Use restrictive
file permissions and secret-file backups; never print the value, place it in a
command argument, or commit it. COP authenticates the end user and derives a
stable opaque `userId` using a separate HMAC secret before calling the Router.
The Router hashes that identifier again for per-user limits and audit.

The Router already has access to OpenAI `gpt-6-luna`: its external economy tier
is enabled. The missing configuration concerns only its separate local tier.
SIM commit `d2c0cd5` prepares a typed `cop_chat` contract and permits Luna only
for positively classified synthetic or public aggregate content. This commit
is deployed for the limited pilot; network access or an environment flag alone
cannot activate general chat. A read-only probe
from the Router container reached one of COP's existing Ollama endpoints and
confirmed that the COP fast model is present. Configure that local tier for
internal chat, or keep internal chat on the existing COP path until it is
available. Never silently send internal or protected content to Luna.

## Data classification and context release

COP is the authority for data classification, authorization and context
selection. Treat the user's question and all automatically collected COP
context as `internal` unless a field is positively proved synthetic or public
aggregate. Never infer that a whole prompt is public from its task name.

| Class | Examples | Router release | External model |
| --- | --- | --- | --- |
| Synthetic | Explicitly marked fictitious exercise text | Allow after validation | Luna only after explicit approval of this exact content path |
| Public aggregate | Counts without names, positions, identifiers or free text | Allowlisted projection | Luna only after explicit approval of this exact content path |
| Internal | Ordinary chat question and nonpublic COP operational context | Only the approved, bounded context projection | Denied for COP chat |
| Protected | Decrypted private or group messages, personal reports, restricted incident details, credentials, raw partner data | Exclude by default; any future exception needs a separate decision and opt-in | Denied |

The chat adapter must build an explicit allowlist before serialization. It must
not forward client-supplied `chatContext`, indexed or semantic excerpts derived
from private messages, unrestricted incident/report objects, hidden map layers,
tokens, or raw attachments. It must reject a request if its allowed projection
cannot be constructed safely. Ordinary free-text questions default to
`dataClass=internal`, `preference=local`, `allowExternal=false` and
`allowPaidEscalation=false`. An approved synthetic or public-aggregate path may
request Luna only with an explicit class, the SIM `cop-chat-context-v1`
structure, `cop-policy-reviewed-v1` attestation and `allowExternal=true`.
Neither a 429, a 503, nor a timeout may invoke the
old provider or bypass the Router to call OpenAI for the same request.

The current rich COP chat context cannot be assumed safe for forwarding: the
route can include decrypted client-provided `chatContext`, alerts, community
reports, incidents, map results and retrieved documents. The launch projection
and response evidence must be tested together so citations never imply that
the model saw excluded material. Until that is done, leave the chat switch off.

The staged adapter accepts no raw `AiCopQuery` context. Its internal variant
forwards only a bounded question and the minimal typed `internal` context.
Its external variants use fixed reviewed question templates and exact-key
synthetic facts or numeric aggregates. It derives an opaque stable user ID with
a dedicated HMAC secret and rejects unexpected Router model tiers. It has no
direct provider call or fallback. Structural checks alone cannot prove that a
supplied fact is genuinely synthetic or that an aggregate came from a public
source. The limited synthetic route uses server-owned fixed facts and returns
no citations. Any future public aggregate route needs a verified source-owned
numeric producer; the adapter is not authorization to attest arbitrary client
input. The existing AI agent dialog offers a separate exercise action; its
free-text question and timeline remain on their existing route.

## Limits, evidence and activation

The Router owns model choice, the daily and monthly cost caps, per-user daily
request cap, and token/cost audit. The SIM administrator view shows Router
aggregate usage, not provider billing and not just COP usage. Keep direct
external paths for unrelated COP AI functions under separate review; disable
any direct external path for the migrated chat function.

Before activation, test authorized chat and identity attribution, protected
content exclusion, SIM usage increment, daily/monthly/per-user 429 responses,
Router/model/database outages, and no fallback to direct OpenAI. Exercise the
production rollback: turn off only the chat Router switch, restart `cop-api`,
verify its former local chat path, preserve audit rows, and leave other AI
functions unchanged. Activate chat only after all these checks pass and the
network change is approved. Record exact image IDs, commits and test results
in the runbook.

## Běžný chat přes interní lokální model

Přepínač `COP_AI_CHAT_ROUTER_FULL_ENABLED=false` je oddělený od cvičného
pilotu. Po zapnutí vede `/api/v1/ai/chat-agent/query` a jeho job wrapper
výhradně přes autentizovaný Router s neprůhlednou stabilní identitou,
`dataClass=internal`, `preference=local` a `allowExternal=false`. COP vybírá
nejvýše 16 typovaných výňatků z viditelné konverzace a oprávněných dat,
Router nepřijímá celý `compressedContext`. Přílohy, syrové incidenty,
objekty bez uživatelského čtecího filtru a indexované dokumenty se vynechají.
Odpověď neuvádí citace k vyloučeným podkladům. Limit nebo výpadek vrací
429/503 bez náhradního volání COP AI gateway. Vypnutí tohoto jediného
přepínače obnoví původní chat a ponechá cvičný pilot beze změny. Ostatní AI
funkce COP tento přepínač neovlivňuje.
