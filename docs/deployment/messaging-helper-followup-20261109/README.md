# Remaining four Synapse helpers — source-bound review, 9 November 2026

**Review only: no production writes, deletes, rebuilds, configuration or auth
requests.** These stages are separate from the already completed push-summary
position repair and from native configuration/token-renewal repairs. They do not
justify wiping chats or claiming message delivery.

## Evidence and scope

The [source manifest](source-provenance.json) pins methods/migrations from the
actual Synapse image`b2a34f5a…`. Public source snapshots for local review are
`/private/tmp/cop-synapse-helper-sources-20261109.json` and
`/private/tmp/cop-synapse-helper-detail-sources-20261109.json`; no credentials or
user content are in those files. No health/log polling or fresh database snapshot
was performed for this source review. The separately requested single owner97
log comparison is distinct.

The last earlier read-only aggregate had all four singleton tables empty. It had
27events/MAX32390, zero receipt rows, zero push-summary rows, three user stats
rows/MAX completed32375, no room stats rows, three directory entries, and no
background updates. The repaired push-summary position then persisted at0.
**These are historical observations, not a fresh CAS authorization.** The native
current-state-delta boundary, effective forget-on-leave policy and eligible leave
transitions have not been established by this review.

The [pure planner](../../../scripts/synapse-helper-state/plan_remaining.py), SHA
`ce4e766db4f61d951de7829992718aa30a55c39580efc19116c55c2354224552`,
produces review decisions only and has no database/network/execution interface.
[The example](synthetic-review-plan.json) uses synthetic boundaries100/95 and is
**not** a production plan. [Validation](validation.json) records13 passing planner
tests, not native-worker integration acceptance.

## 1. Receipt cursor: first, independently

`event_push_summary_last_receipt_stream_id` is read before notification rotation.
Its absence fails `_handle_new_receipts_for_notifs_txn` before normal maintenance.
The native loop processes receipts in stream order in batches of100, handles
threaded/unthreaded receipts, removes already-read non-highlight push actions and
recalculates existing per-room/thread summaries. This is normal derived-notification
maintenance, not deletion of chat events. It influences unread badges and push
notification bookkeeping; it is not the encrypted-send acknowledgment owner.

Minimal candidate when a **fresh stopped-writer CAS proves no receipts**:

```sql
INSERT INTO public.event_push_summary_last_receipt_stream_id (lock,stream_id)
VALUES ('X',0) RETURNING lock,stream_id;
```

Preconditions: target count0, expected native schema/unique-X/no unreviewed
triggers, exactly one already restored summary-position row, summary position at
or above existing summary row positions, receipts count0, native receipt stream
sequence consistent, and exact preserved source/identity/key counts. Existing
summary rows and its position must not be reset. Zero skips no stored receipt;
normal processing can advance to the existing receipt token and handle future
receipts. If receipts now exist, **hold this narrow empty-state plan**; separately
review native threaded replay from a proven boundary. Never seed toMAX merely to
suppress the error, because that can skip unread-state updates.

Required fixture: zero receipts and preserved raw push actions; existing summary
progress retained; receipt arriving after restart; threaded and unthreaded read
receipts do not restore already-read badges; chunk limit100; interruption before
commit and uncertain transport do not produce a second insert. A real native
processor fixture is still required; it has not been run by this source review.

## 2. Statistics: boundary plus native absolute rebuild, never bare MAX

Native `StatsHandler` consumes current-state deltas from its global position.
`StatsStore` uses per-room completed positions to skip covered deltas. Native
initial room/user handlers calculate absolute membership/current-state counters
and set their completion positions. Existing mixed user stats and missing room
stats make a bareMAX position unsafe: it could hide unprocessed state.

Candidate requires a consistent paused-writer snapshot with event boundary`B`
and state-delta boundary`D <= B`. Atomically insert the missing global position at
`B` **and** enqueue both native jobs, using the installed background-update schema:

1. `populate_stats_process_rooms`, progress`{}`; then
2. `populate_stats_process_users`, progress`{}`, depends on the room job.

This follows the native absolute-baseline pattern in delta56; the room baseline
rebuild is also registered by delta73/22. The global boundary is justified only
by complete native recalculation of all existing rooms/users, not by the INSERT
alone. Never delete existing statistics or overwrite helper rows to force it.
Do not reuse/adopt unknown pending jobs or staging files. Verify materialized
membership columns before scheduling, rather than replaying schema migrations.

Acceptance: every relevant current room/user has a completed baseline covering
`D`; counters equal native current membership/state, including mixed preexisting
user rows, with no double-count. Test events arriving between boundary capture,
room baseline and user baseline; native processor/job concurrency must be verified
against this exact image. Test interruption/resume and a failing room calculation;
a job disappearing is not proof of complete coverage. No live action is ready
until these worker-level fixtures and preservation checks pass.

## 3. User directory: NULL plus complete native chain

A missing row is different from a validNULL position. Native incremental handling
returns without processing while the position isNULL. Therefore insertingNULL
alone merely silences the error and leaves directory processing inactive.

Candidate: missing-row INSERT`('X',NULL)` and the full native chain from
`delta/53/user_dir_populate.sql` /`delta/73/22_rebuild_user_dir_stats.sql`:

1. `populate_user_directory_createtables`;
2. `populate_user_directory_process_rooms` depends on1;
3. `populate_user_directory_process_users` depends on2;
4. `populate_user_directory_cleanup` depends on3.

**This is a derived-directory rebuild, not an INSERT-only repair.** The native
room job calls`delete_all_from_user_dir()` at its start, rebuilding search and
public/private sharing indexes from authoritative room state. The cleanup writes
the staged delta position and removes its own temporary staging tables. Existing
accounts, memberships, events, E2EE stores and identity mappings are not its
rebuild targets. Directory search can be incomplete temporarily. Existing
`search_all_users` and local-profile privacy rules must stay unchanged.

Require explicit review of that native derived deletion/rebuild; it is not
covered by the earlier single push-summary INSERT. Preserve unknown pending work.
Required fixtures: local/private/public room visibility, deactivated/left users,
local profile privacy, interruption at each dependency, and deltas arriving after
the captured staging position. Publish baseline completion only after cleanup
sets a real position and incremental catch-up covers later deltas. These native
fixtures remain unexecuted here.

## 4. Room forgetter: conditional boundary, not guessed

The native handler reads the singleton even when `forget_on_leave` is false.
When false, it normally advances to the current event boundary without forgetting
rooms. With this effective policy freshly proven and bound to the config, a
missing row can use`B` (the native migration's current-event boundary).

When the policy is true, the handler processes local join-to-leave transitions and
calls native`forget`. It tolerates400 when the user has since rejoined; this does
not authorize retroactive forgetting of other rooms. A safe zero/replay candidate
requires a complete retained-delta check proving **zero eligible local leave
transitions**, held by a fresh CAS. Unknown policy or any eligible transitions
means **hold**: review the intended historical forgetting boundary and downstream
room-visibility consequences separately. Do not insertNULL (not nullable), guess
MAX to skip transitions, or replay zero to silently forget historical rooms.

Required fixtures: disabled policy does not call forget; no-candidate replay;
join→leave; leave→rejoin protection; interruptions; config/delta changes reject
CAS. No effective production policy/delta proof or real forgetting fixture has
been claimed by this source review.

## Shared delivery and protection

Separate stages, each with an exact immutable plan, one attempt, original
container/image/config/network pins, writer inventory, coordinated stop and zero
other DB writers, schema/trigger/constraint proof and fresh readback. No global
TRUNCATE, shared identity reset, new device, key-store reset, WAF change or
agent-generated message/call. Never overwrite an existing helper after uncertainty.
For native jobs, preserve committed progress and resume by their registered owner;
never reset progress to`{}` after work started. A rollback cannot blindly remove
an advanced cursor or committed job/result.

The easiest next bounded stage is the receipt cursor **if its empty-receipt
preflight remains true**. Statistics and directory need their own actual-image
baseline/concurrency tests; the forgetter requires the currently unknown policy
and leave-transition evidence. None is a reason to block the independent native
configuration/renewal fix or to erase user chats.
