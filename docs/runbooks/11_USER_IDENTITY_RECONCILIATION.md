# User Identity Reconciliation for COP Groups

Status: production runbook, 2026-05-30.

COP community groups and CSM Messaging conversations must use the same canonical
user id: the OIDC `sub` claim stored in `cop_user_profiles.subject_id`.
`preferred_username` and email are lookup handles only.

## When to Run

Run this before production rollout of group messaging, and after any historical
manual edits where `cop_community_group_members.subject_id` may contain a
username such as `cop.operator1`.

## Preconditions

- Every target user has signed in to COP at least once, so `cop_user_profiles`
  contains a row for that user.
- COP API has been deployed with `/api/v1/users/search`.
- A database backup exists.

## Detect Rows That Need Backfill

```sql
select
  g.name as group_name,
  m.group_id,
  m.subject_id as stored_subject_id,
  m.username,
  p.subject_id as canonical_subject_id
from cop_community_group_members m
join cop_community_groups g on g.group_id = m.group_id
left join cop_user_profiles p
  on lower(p.username) = lower(m.subject_id)
  or lower(coalesce(p.email, '')) = lower(m.subject_id)
where p.subject_id is not null
  and m.subject_id <> p.subject_id
order by g.name, m.username;
```

## Backfill COP Group Members

```sql
begin;

with resolved as (
  select
    m.group_id,
    m.subject_id as old_subject_id,
    p.subject_id as new_subject_id,
    p.username,
    p.display_name
  from cop_community_group_members m
  join cop_user_profiles p
    on lower(p.username) = lower(m.subject_id)
    or lower(coalesce(p.email, '')) = lower(m.subject_id)
  where m.subject_id <> p.subject_id
),
inserted as (
  insert into cop_community_group_members (
    group_id,
    subject_id,
    username,
    display_name,
    role,
    status,
    requested_at,
    joined_at
  )
  select
    m.group_id,
    r.new_subject_id,
    r.username,
    r.display_name,
    m.role,
    m.status,
    m.requested_at,
    m.joined_at
  from cop_community_group_members m
  join resolved r
    on r.group_id = m.group_id
   and r.old_subject_id = m.subject_id
  on conflict (group_id, subject_id) do update set
    username = excluded.username,
    display_name = excluded.display_name,
    role = case
      when cop_community_group_members.role = 'owner' then 'owner'
      else excluded.role
    end,
    status = case
      when cop_community_group_members.status = 'active' then 'active'
      else excluded.status
    end,
    joined_at = coalesce(cop_community_group_members.joined_at, excluded.joined_at)
  returning group_id, subject_id
)
delete from cop_community_group_members m
using resolved r
where m.group_id = r.group_id
  and m.subject_id = r.old_subject_id;

commit;
```

After the COP DB backfill, open each affected COP group in the web UI and trigger
member synchronization, or call the existing COP-to-CSM Messaging member sync
path from the maintenance console. CSM Messaging conversation members should
then contain the same canonical subject ids as COP.

## Verification

```sql
select g.name, m.subject_id, m.username, m.role, m.status
from cop_community_group_members m
join cop_community_groups g on g.group_id = m.group_id
where m.subject_id = m.username
   or m.subject_id like '%.%'
order by g.name, m.username;
```

Expected result after migration: no rows for normal Keycloak usernames.
