-- What the people using this portal did, and when.
--
-- The portal has always recorded what happened to a *delivery* — a status, a
-- timestamp, a rider snapshot — and never who made it happen. Two ops working
-- the same queue, an admin who reset somebody's password, a merchant who
-- exported a year of the ledger: all of that left the same trace, which is none.
-- This table is that trace, and the Activity tab is the only place it is read.
--
-- ---------------------------------------------------------------------------
-- Why the rows are written by the application and not by triggers
-- ---------------------------------------------------------------------------
-- The obvious design is an `after insert or update` trigger on deliveries,
-- settlements and profiles that writes a row using auth.uid(). It was rejected,
-- because in this app auth.uid() is null on exactly the writes worth recording:
--
--   * every link redemption goes through createAdminClient() — a rider
--     accepting a job, a recipient confirming receipt, a rider closing a
--     delivery (lib/deliveryLinks.ts). Those are anonymous requests carrying a
--     capability token, and a trigger would attribute the resulting status
--     change to nobody.
--   * account creation, deactivation and password resets go through the Auth
--     admin API and the service-role client (lib/accounts.ts).
--   * every settings and API-key write is service-role only (lib/settings.ts),
--     because app_settings is granted to no other role.
--
-- A trigger also only ever sees a column diff. "status: Requested -> Pending,
-- rider_id: null -> 0f3a…" is not what an admin opening this page is asking; the
-- question is "who put Yaw on SOMO-4F2A1". That sentence exists in the Route
-- Handler and nowhere else, so that is where it is written down.
--
-- The trade this makes, stated plainly: a write that reaches Postgres by some
-- other route — psql, the Supabase dashboard's table editor, a future service
-- that skips the Route Handlers — leaves no row here. That is acceptable while
-- this app is the only writer. It stops being acceptable the day a second one
-- exists, and the fix then is triggers *in addition to* these rows, not instead
-- of them.

-- ---------------------------------------------------------------------------
-- user_activity
-- ---------------------------------------------------------------------------
create table public.user_activity (
  -- Identity, not uuid, unlike every other table here. This one is append-only
  -- and insert-heavy, and a random v4 uuid primary key scatters those inserts
  -- across the whole btree. It also gives the listing a total order that matches
  -- the order things happened in, which is the entire point of the screen.
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),

  -- Null when the account is later deleted, and for the handful of entries the
  -- portal records about itself. The two snapshot columns are what keep such a
  -- row readable — see below.
  actor_id uuid references public.profiles (id) on delete set null,
  -- Snapshotted for the same reason settlements.recorded_by_name is: an audit
  -- line that reads "0f3a1c… changed the pricing" is not an audit line. Roles
  -- change and accounts get renamed, and this table has to say what was true
  -- when the thing was done, not what is true now.
  actor_username text not null default '',
  actor_role text not null default '',

  -- A dotted verb from ACTIVITY_GROUPS in lib/activityText.ts —
  -- 'delivery.rider_assigned', 'settlement.voided', 'auth.signed_in'. Kept as
  -- text rather than an enum so adding one is an application change, not a
  -- migration and a deploy ordering problem.
  action text not null,

  entity_type text not null default '',
  -- Text, not uuid, on purpose. Not everything this portal acts on is uuid-keyed:
  -- pricing and settings are singleton rows, and an account is addressed by
  -- username throughout the API. Forcing a uuid here would mean an extra SELECT
  -- at the log site purely to satisfy a column type — and a log write must never
  -- add a query to the request it is describing.
  entity_id text not null default '',
  -- What to call it on screen: an order number, a username, a rider's name.
  -- Snapshotted like the actor, and for the same reason.
  entity_label text not null default '',

  -- Small, structured context — old and new status, how many rows an export
  -- carried, which fields a settings save touched. Never a whole row, never a
  -- request body, and never a secret: see the comment on the table below.
  details jsonb not null default '{}'::jsonb,

  constraint user_activity_action_not_blank check (length(btrim(action)) > 0)
);

-- The default listing: newest first. Composite because the page reads it with
-- the same (sort, id) keyset the rest of the portal uses — see lib/pagedRead.ts
-- for why offset paging is not an option on a table that only grows.
create index user_activity_created_idx
  on public.user_activity (created_at desc, id desc);

-- "What has this person been doing", which is the second question the page is
-- opened for and the reason the filter exists.
--
-- Keyed on the snapshot rather than on actor_id, which is what the filter
-- actually passes: the dropdown is built from usernames, and a username is also
-- the only handle left on a row whose account has since been removed. There is
-- deliberately no index on actor_id — nothing in this portal deletes a profile
-- (accounts are deactivated), so the ON DELETE SET NULL that would scan this
-- table has no path that fires it, and a fourth index is a cost paid on every
-- single insert.
create index user_activity_actor_idx
  on public.user_activity (actor_username, created_at desc, id desc);

-- "Show me every settlement that was voided this year." Without this the action
-- filter is a sequential scan over the whole history, and this is the one table
-- in the schema with no natural bound on its size.
create index user_activity_action_idx
  on public.user_activity (action, created_at desc, id desc);

comment on table public.user_activity is
  'Append-only record of what portal users did. Written by lib/activity.ts through the service-role client; readable by admin only. Never holds secrets, tokens, passwords or raw request bodies.';
comment on column public.user_activity.actor_role is
  'The actor''s role at the time of the action, snapshotted — roles change, and this row must not.';
comment on column public.user_activity.action is
  'Dotted verb, matching ACTIVITY_GROUPS in lib/activityText.ts.';
comment on column public.user_activity.details is
  'Small structured context for the sentence on screen. Not a row copy, and never anything sensitive.';

-- ---------------------------------------------------------------------------
-- RLS — readable by admin, writable by nobody
-- ---------------------------------------------------------------------------
-- The `ensure_rls` event trigger enables RLS on new public tables by itself;
-- stating it here means the intent survives a project where that trigger is
-- absent. FORCE is safe because the only writer is the service-role client,
-- which has BYPASSRLS and is not subject to either.
alter table public.user_activity enable row level security;
alter table public.user_activity force row level security;

-- Supabase's default privileges hand every verb on a newly created table to
-- anon, authenticated *and* service_role (see 20260818144747 for how that was
-- found), so starting from nothing is not decorative here — without it,
-- `authenticated` would hold INSERT and DELETE on the audit trail, and the
-- GRANTs below would be a description of intent rather than of the privileges
-- this table actually has. Verified by reading back
-- information_schema.role_table_grants after applying this file.
revoke all on public.user_activity from anon, authenticated, service_role;

-- SELECT only, and RLS below decides that it is admin's. No INSERT, no UPDATE,
-- no DELETE to any signed-in role: there is no shape of request from a browser
-- that writes, edits or removes a line of this table. An audit trail its own
-- subjects can edit is not an audit trail.
grant select on public.user_activity to authenticated;

-- No UPDATE and no TRUNCATE, even for service_role. Nothing in the portal amends
-- an entry — a correction is a new line — and leaving those verbs ungranted
-- means a stray .update(), or a TRUNCATE typed at the wrong prompt with the
-- service key, is a privilege error rather than a silent rewrite or an erased
-- history. DELETE is granted for one caller only: the retention sweep in
-- lib/activity.ts. It is the one hole in "append-only", and it is deliberate:
-- the alternative is a table with no ceiling on its size.
grant select, insert, delete on public.user_activity to service_role;
-- No grant on the identity sequence, deliberately: unlike a `serial`, an
-- IDENTITY column's sequence is owned by the column and its privileges are not
-- checked on insert. A grant here would only imply it was load-bearing.

-- Defence in depth rather than the only defence: the page already redirects a
-- non-admin, and the Route Handlers already check. This is what makes those
-- checks belt-and-braces instead of load-bearing — ops or finance hitting the
-- Data API directly get an empty array, not somebody else's audit trail.
create policy user_activity_select_admin
  on public.user_activity
  for select
  to authenticated
  using ((select private.portal_role()) = 'admin');
