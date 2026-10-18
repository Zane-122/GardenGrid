create table if not exists public.shop_items (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null,
  oxygen_cost numeric not null check (oxygen_cost > 0),
  image_path text not null,
  created_at timestamptz not null default now()
);

comment on table public.shop_items is
  'Catalog of things you can buy for the garden, other than plants.';
comment on column public.shop_items.image_path is
  'Object key in the shop-items storage bucket.';
comment on column public.shop_items.oxygen_cost is
  'Spendable oxygen charged once per purchase. Lifetime totals are not reduced.';

create table if not exists public.user_shop_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  shop_item_id uuid not null references public.shop_items(id),
  garden_tile_id uuid references public.garden_tiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.user_shop_items is
  'One purchased copy of a shop item. garden_tile_id is set while it is laid on a plot.';
comment on column public.user_shop_items.garden_tile_id is
  'Plot this copy is laid on. Null while it is still in the tray.';

create unique index if not exists user_shop_items_one_per_plot
  on public.user_shop_items (garden_tile_id)
  where garden_tile_id is not null;

create index if not exists user_shop_items_user_id_idx on public.user_shop_items (user_id);

alter table public.shop_items enable row level security;
alter table public.user_shop_items enable row level security;

drop policy if exists "Authenticated users can read the shop catalog" on public.shop_items;
create policy "Authenticated users can read the shop catalog"
  on public.shop_items for select to authenticated
  using (true);

drop policy if exists "Users can read their own shop items" on public.user_shop_items;
create policy "Users can read their own shop items"
  on public.user_shop_items for select to authenticated
  using (auth.uid() = user_id);

grant select on table public.shop_items to authenticated;
grant select on table public.user_shop_items to authenticated;
grant select, insert, update, delete on table public.shop_items to service_role;
grant select, insert, update, delete on table public.user_shop_items to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-items',
  'shop-items',
  true,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true;

drop policy if exists "Public read shop item images" on storage.objects;
create policy "Public read shop item images"
  on storage.objects for select
  to public
  using (bucket_id = 'shop-items');

insert into public.shop_items (slug, name, description, oxygen_cost, image_path)
values (
  'stone-path',
  'Stone path',
  'A paving stone you can lay on one plot.',
  3000,
  'stone-path.jpg'
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    oxygen_cost = excluded.oxygen_cost,
    image_path = excluded.image_path;

create or replace function public.buy_shop_item(target_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cost numeric;
  balance numeric;
  owned_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select oxygen_cost into cost
  from public.shop_items
  where id = target_item;

  if cost is null then
    raise exception 'That item is not in the shop';
  end if;

  select oxygen into balance
  from public.user_currency
  where user_id = uid
  for update;

  if balance is null or balance < cost then
    raise exception 'Not enough oxygen';
  end if;

  update public.user_currency
  set oxygen = oxygen - cost,
      updated_at = now()
  where user_id = uid;

  insert into public.user_shop_items (user_id, shop_item_id)
  values (uid, target_item)
  returning id into owned_id;

  return owned_id;
end;
$$;

create or replace function public.place_user_shop_item(
  owned_item_id uuid,
  target_col integer,
  target_row integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_tile uuid;
  current_tile uuid;
  occupant uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select garden_tile_id into current_tile
  from public.user_shop_items
  where id = owned_item_id and user_id = uid
  for update;

  if current_tile is null and not found then
    raise exception 'You do not own that item';
  end if;

  select id into target_tile
  from public.garden_tiles
  where user_id = uid and col = target_col and row = target_row;

  if target_tile is null then
    raise exception 'That plot is not part of your garden';
  end if;

  if current_tile is not null and current_tile = target_tile then
    return;
  end if;

  select id into occupant
  from public.user_shop_items
  where user_id = uid and garden_tile_id = target_tile and id <> owned_item_id
  for update;

  if occupant is not null and current_tile is not null then
    update public.user_shop_items
    set garden_tile_id = null
    where id in (owned_item_id, occupant);

    update public.user_shop_items
    set garden_tile_id = target_tile
    where id = owned_item_id;

    update public.user_shop_items
    set garden_tile_id = current_tile
    where id = occupant;
    return;
  end if;

  if occupant is not null then
    update public.user_shop_items
    set garden_tile_id = null
    where id = occupant;
  end if;

  update public.user_shop_items
  set garden_tile_id = target_tile
  where id = owned_item_id;
end;
$$;

create or replace function public.clear_user_shop_item(owned_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.user_shop_items
  set garden_tile_id = null
  where id = owned_item_id and user_id = auth.uid();

  if not found then
    raise exception 'You do not own that item';
  end if;
end;
$$;

revoke all on function public.buy_shop_item(uuid) from public, anon;
grant execute on function public.buy_shop_item(uuid) to authenticated, service_role;

revoke all on function public.place_user_shop_item(uuid, integer, integer) from public, anon;
grant execute on function public.place_user_shop_item(uuid, integer, integer) to authenticated, service_role;

revoke all on function public.clear_user_shop_item(uuid) from public, anon;
grant execute on function public.clear_user_shop_item(uuid) to authenticated, service_role;

comment on function public.buy_shop_item(uuid) is
  'Spends the item''s oxygen cost from the spendable balance and gives the user one copy.';
