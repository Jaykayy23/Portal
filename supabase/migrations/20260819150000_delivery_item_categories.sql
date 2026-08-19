-- What is being delivered.
--
-- Deliveries recorded the route, the price and the declared value but never the
-- kind of item, so ops had no way to know a bike was carrying medication rather
-- than documents. This adds an admin-configurable list of item categories and a
-- column on deliveries to hold the merchant's choice.
--
-- Why a new singleton table rather than app_settings or pricing_params:
--
--   app_settings   is granted to no public role — it holds the provider secrets.
--                  Merchants have to read this list to pick from it.
--   pricing_params has exactly the right access shape (all read, admin write) but
--                  a category has no bearing on the quote; parking it there would
--                  make "pricing" mean two unrelated things.
--
-- So delivery_options is a third singleton with the pricing_params access shape,
-- and a home for whatever else the New delivery form needs configured later
-- (delivery type is still a hard-coded enum, and is the obvious next candidate).
create table public.delivery_options (
  id smallint primary key default 1,
  -- Ordered list of labels, e.g. ["Food", "Documents"]. Labels rather than
  -- {id, label} pairs because deliveries store the chosen label directly — see
  -- the column comment below.
  item_categories jsonb not null default
    '["Food", "Medication / pharmacy", "Documents", "Electronics", "Clothing / fabric",
      "Groceries", "Cosmetics", "Spare parts", "Parcel / package", "Other"]'::jsonb,
  updated_at timestamptz not null default now(),

  constraint delivery_options_singleton check (id = 1),
  -- Must be an array: the form iterates over it. Per-element shape (a non-blank
  -- string) is checked in the Route Handler, which a CHECK cannot do without a
  -- subquery over jsonb_array_elements.
  constraint delivery_options_categories_is_array
    check (jsonb_typeof(item_categories) = 'array')
);

insert into public.delivery_options (id) values (1);

comment on table public.delivery_options is
  'Single row of New delivery form options. Readable by every signed-in role, writable by admin.';

create trigger delivery_options_touch_updated_at
  before update on public.delivery_options
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- deliveries.item_category
-- ---------------------------------------------------------------------------
-- The label, not a foreign key: the same reasoning as the rider and customer
-- snapshot columns. A delivery should still say what it carried after an admin
-- renames or removes that category, and a merchant needs no read access to the
-- options table for their own history to render.
--
-- Defaults to '' so the rows that already exist stay valid — anything filed
-- before this migration genuinely has no category, and the log shows a dash.
alter table public.deliveries
  add column item_category text not null default '';

comment on column public.deliveries.item_category is
  'What was being sent, chosen from delivery_options.item_categories and snapshotted here.';

-- ---------------------------------------------------------------------------
-- RLS — same shape as pricing_params: everyone reads, admin writes
-- ---------------------------------------------------------------------------
alter table public.delivery_options enable row level security;
alter table public.delivery_options force row level security;

grant select, update on public.delivery_options to authenticated;
grant select, insert, update, delete on public.delivery_options to service_role;

-- Every signed-in role reads the list: merchants pick from it on the New
-- delivery form.
create policy delivery_options_select_authenticated
  on public.delivery_options
  for select
  to authenticated
  using (true);

create policy delivery_options_update_admin
  on public.delivery_options
  for update
  to authenticated
  using ((select private.portal_role()) = 'admin')
  with check ((select private.portal_role()) = 'admin');
