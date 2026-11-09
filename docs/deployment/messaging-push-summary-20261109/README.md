# Missing push-summary position — 9 November 2026

Status: the exact one-row repair was applied on9November2026 and Synapse
restarted at13:46:28CET. Native sync/delivery acceptance remains separate.
This is separate from the earlier completed `to_device` sequence repair.

## Observed fault

Owner phone96 was installed and running. During13:21–13:30CET, existing Synapse
logs contained120 HTTP404 `No row found` responses to legacy GET `/sync` and four
account-data404 responses. All120 sync requests were parsed: no filter or since
parameter;120 had timeout and118 had full_state. The current `user_filters` table
had one row for one principal; no filter content or identifiers were exported.
A stale stored filter therefore does not explain those120 unfiltered requests.

Read-only SQL proved these five native singleton tables empty:
`stats_incremental_position`, `user_directory_stream_pos`,
`room_forgetter_stream_pos`, `event_push_summary_last_receipt_stream_id`,
`event_push_summary_stream_ordering`. Background errors were29 each in stats,
user directory and room forgetter processors, plus18 notification receipt errors.
These background errors are real; generic readiness200 did not establish full
Matrix sync functionality.

This candidate repairs **only** `event_push_summary_stream_ordering`. The installed
pinned Synapse source `storage/databases/main/event_push_actions.py`,
`_get_unread_counts_by_pos_txn` lines693–698, unconditionally reads its single value
with `simple_select_one_onecol_txn`. With zero rows, this raises the same404
`No row found`. `storage/schema/main/delta/40/event_push_summary.sql` initializes
this table to0. The read-only plan proves existing summary and receipt tables
empty, while retaining five push actions; zero is the native initial aggregation
floor and does not replay already summarized rows in this verified state.

The precise call stack for each historical404 was not logged. The missing row
and matching sync source predicate are proven; the post-repair observation must
still establish whether sync404 stops. Duplicate local echo alone does not prove
corrupt or obsolete chat data, and no whole-chat wipe is proposed.

## Exact narrow plan

[Read-only plan](readonly-plan.json), SHA
`38f98e98d513c096d5cb9b3d5c54e07f5669fb8ecc6e2d6cb526500e815306a6`,
is bound to the original healthy Synapse container/image/spec/network and complete
writer inventory. Stopped failed/rollback peers have restart policy `no`.

[Repair source](../../../scripts/synapse-helper-state/repair.py), SHA
`f19dc03689a71ac379dc764cb166b7d2a148896ad91580739a78d36cb334f8eb`, defaults
to read-only. The only DML is:

```sql
INSERT INTO public.event_push_summary_stream_ordering (lock,stream_ordering)
VALUES ('X',0) RETURNING lock,stream_ordering;
```

Apply requires the exact reviewed plan. After stopping all observed Synapse
writers, it requires zero other database sessions, obtains advisory/table locks,
and freshly compares all source counts/maxima, helper shape/constraints/no user
triggers, database identity and preserved user/key/state counts. Only session
count may differ from the live preflight, and it must become zero. Both summary
and receipt tables must remain empty. An existing helper row always refuses the
operation. No sequence, filter, message, identity, key, grant or other singleton
is changed. A one-use attempt marker prevents a second insert attempt.

The independent bounded maintenance client runs the same pinned Synapse image,
with no homeserver, ports, writable root or credential files. Credentials remain
in server RAM/stdin. After uncertainty, readback alone is permitted; no second
insert and no deletion-based rollback. Unproven readback leaves the service
stopped. Proven outcome permits restarting only the original exact container.

## Verification and acceptance

[Test receipt](test-receipt.json): six exact client-guard tests and five runtime
lifecycle fixtures passed, including uncertain commit/rollback and blocked restart
on unproven readback. A real isolated PostgreSQL17 RAM-only fixture verified the
exact insert, readbackX/0, duplicate refusal and unchanged synthetic event,
identity and key fixture digest. Its container was removed. Fixture boundaries
are explicitly distinguished from production execution.

After one separately reviewed apply: read back the helper and preserved counts,
verify original CID/image/config and cleanup, observe existing `/sync` results
without generating an owner request, and let Jízda perform owner-authorized
native acceptance. Joined membership, message acknowledgment/delivery and restored
UI are separate claims; no forced join or agent-generated message is permitted.

The other four missing helper rows remain separate work. Mixed derived statistics
already exist, so blindly inserting maximum positions or rebuilding everything
could skip or double-count derived work. This candidate neither fixes nor masks
those errors. Do not expand its INSERT scope during execution.

## Actual production result

The [apply receipt](apply-receipt.json) records the one reviewed apply: all CAS
checks passed with zero other database sessions. Only the helper changed from
missing to`X/0`; source counts/maxima and eight user/key/state counts were identical
before/after. The transaction committed and readback succeeded. The same Synapse
container/image/config restarted; the maintenance client was removed. No other
singleton was repaired, no token issued and no message was generated.

[Fresh readback](post-apply-readback.json),13:48:26CET, confirms the helper
persists, preserved counts remain unchanged, exact runtime spec matches, Synapse
healthy/restart0 and Messaging healthy with its historical count unchanged. Public
COP/Messaging readiness returned200. The passive post-start window13:46:28–13:48:26
contained **zero observed sync requests**, therefore it is not evidence of a
successful sync response or delivery. Jízda requested one owner-authorized phone96
probe, including only opening/explicitly accepting the vehicle invitation and
checking already pending messages. Its result is pending.

No further runtime request, reset or live helper change is authorized by this
receipt. After a future restore or deliberate data reset, verify native helper
cardinality in addition to stream sequences; do not equate generic health200 with
working sync. The cause/date of loss of these helper rows is not established here.

## Subsequent single owner probe96

[The13:54:21CET owner probe and one passive comparison](owner-probe96-passive-observation.json)
confirmed HTTP202/valid invitation, followed by client`transportNotReady` before
any native join was invoked. Existing logs13:48–13:56CET contain33sync200 and
126sync401 responses, with no observed sync404. The401s are observed in Synapse
itself; the particular device/reason is not yet identified. They cannot be
described as proven WAF denials. Five membership reads returned200; no send/join
context was observed on this logging surface. This does not establish delivery.

Jízda found that explicit invitation acceptance refused an unready live client
before attempting the same fenced credential/transport restoration used by other
operations. Its repair remains a separate native candidate requiring acceptance;
this server observation does not authorize resetting identities, keys or stores.
The four other missing background helper rows remain unchanged.
