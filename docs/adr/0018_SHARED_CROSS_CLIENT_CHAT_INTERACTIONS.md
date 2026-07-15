# ADR-0018: Shared Cross-Client Chat Interaction Contract

## Status

Accepted

## Context

COP Chat and COP Mobile used different composer commands and different defaults
for AI routing. The web client exposed technical model names while the native
client offered only an unrelated local summary action. Personal AI, group AI
mentions and queued messages therefore behaved differently even though both
clients called the same backend.

## Decision

The product exposes task-oriented chat interactions: `/ai`, `/souhrn`,
`/rizika`, `/mapa`, `/hlášení`, `/úkoly` and `/přeložit`, plus `@COP AI` where
the assistant is available. COP core owns the TypeScript catalog and parser;
COP Mobile implements the same identifiers, Czech prompts and parsing rules as
its native mirror. Hidden `/fast` and `/reasoning` aliases remain compatible but
model selection is not a primary user decision. Unqualified questions use
`modelPreference=auto` in clients and backend.

Both clients submit only the explicitly visible/decrypted bounded timeline,
the canonical conversation id and, for community groups, the canonical
`groupId`. A native queued question starts AI only after Matrix confirms its
delivery. Generated AI response bodies are excluded from command detection so
offline synchronization cannot recursively invoke AI.

The clients also recognize the stable `COP AI agent` plaintext fallback
envelope used when the Matrix adapter cannot attach richer COP metadata. The
envelope is removed from the visible body and the message is presented under
the AI identity. Provider, model, policy and audit identifiers are secondary
administrator details rather than primary chat content.

SwiftUI presents native slash/member suggestions and a short, human AI work
state. Local on-device summarization remains a separate privacy-preserving tool
named by its user outcome; it does not masquerade as the server COP AI agent.

## Consequences

- The same text triggers the same task and model routing on web and iOS.
- Product vocabulary describes outcomes rather than provider/model internals.
- Group AI requests reach the same authorization path through `groupId`.
- Offline delivery does not lose or duplicate an AI job.
- New commands require matching parser tests and documentation in both clients.
