create table if not exists public.garden_tiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  col integer not null,
  row integer not null,
  created_at timestamptz not null default now(),
  constraint garden_tiles_user_coord_unique unique (user_id, col, row)
);

comment on table public.garden_tiles is
  'Plots a user owns. The starter garden is columns 0-2 and rows 0-3. Bought tiles sit on the edge of owned land.';
comment on column public.garden_tiles.col is 'Column in the garden. The starter garden uses 0, 1, and 2.';
comment on column public.garden_tiles.row is 'Row in the garden. The starter garden uses 0, 1, 2, and 3.';

create index if not exists garden_tiles_user_id_idx on public.garden_tiles (user_id);

alter table public.garden_tiles enable row level security;

drop policy if exists "Users can read their own garden tiles" on public.garden_tiles;
create policy "Users can read their own garden tiles"
  on public.garden_tiles for select to authenticated
  using (auth.uid() = user_id);

grant select on table public.garden_tiles to authenticated;
grant select, insert, update, delete on table public.garden_tiles to service_role;

create or replace function public.seed_starter_garden(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.garden_tiles (user_id, col, row)
  select target_user, col, row
  from generate_series(0, 2) as col
  cross join generate_series(0, 3) as row
  on conflict (user_id, col, row) do nothing;
end;
$$;

create or replace function public.profiles_seed_starter_garden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_starter_garden(new.id);
  return new;
end;
$$;

drop trigger if exists profiles_seed_starter_garden on public.profiles;
create trigger profiles_seed_starter_garden
  after insert on public.profiles
  for each row
  execute function public.profiles_seed_starter_garden();

insert into public.garden_tiles (user_id, col, row)
select profile.id, col, row
from public.profiles as profile
cross join generate_series(0, 2) as col
cross join generate_series(0, 3) as row
on conflict (user_id, col, row) do nothing;

alter table public.garden_slots
  add column if not exists tile_id uuid references public.garden_tiles(id) on delete cascade;

update public.garden_slots as slot
set tile_id = tile.id
from public.garden_tiles as tile
where tile.user_id = slot.user_id
  and tile.col = slot.slot_index % 3
  and tile.row = slot.slot_index / 3
  and slot.tile_id is null;

do $$
begin
  if exists (select 1 from public.garden_slots where tile_id is null) then
    raise exception 'garden slot could not be mapped onto a starter tile';
  end if;
end;
$$;

alter table public.garden_slots
  drop constraint if exists garden_slots_slot_index_range,
  drop constraint if exists garden_slots_user_slot_unique;

alter table public.garden_slots
  drop column if exists slot_index;

alter table public.garden_slots
  alter column tile_id set not null;

alter table public.garden_slots
  drop constraint if exists garden_slots_tile_unique;

alter table public.garden_slots
  add constraint garden_slots_tile_unique unique (tile_id);

comment on column public.garden_slots.tile_id is
  'Owned plot this plant occupies. One plant per tile.';

drop policy if exists "Users can insert their own garden slots" on public.garden_slots;
create policy "Users can insert their own garden slots"
  on public.garden_slots for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.plants p
      where p.id = garden_slots.plant_id and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.garden_tiles t
      where t.id = garden_slots.tile_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update their own garden slots" on public.garden_slots;
create policy "Users can update their own garden slots"
  on public.garden_slots for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.plants p
      where p.id = garden_slots.plant_id and p.user_id = auth.uid()
    )
    and exists (
      select 1 from public.garden_tiles t
      where t.id = garden_slots.tile_id and t.user_id = auth.uid()
    )
  );

drop function if exists public.assign_garden_slot(uuid, integer);
drop function if exists public.clear_garden_slot(integer);

create or replace function public.assign_garden_slot(
  target_plant_id uuid,
  target_col integer,
  target_row integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_tile uuid;
  existing_tile uuid;
  occupant_plant uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.plants
    where id = target_plant_id and user_id = uid
  ) then
    raise exception 'Plant must belong to you';
  end if;

  select id into target_tile
  from public.garden_tiles
  where user_id = uid and col = target_col and row = target_row;

  if target_tile is null then
    raise exception 'That plot is not part of your garden';
  end if;

  select tile_id into existing_tile
  from public.garden_slots
  where user_id = uid and plant_id = target_plant_id;

  select plant_id into occupant_plant
  from public.garden_slots
  where user_id = uid and tile_id = target_tile;

  if existing_tile is not null and existing_tile = target_tile then
    return;
  end if;

  if existing_tile is not null and occupant_plant is not null then
    delete from public.garden_slots
    where user_id = uid and plant_id in (target_plant_id, occupant_plant);

    insert into public.garden_slots (user_id, plant_id, tile_id)
    values
      (uid, target_plant_id, target_tile),
      (uid, occupant_plant, existing_tile);
    return;
  end if;

  if existing_tile is not null then
    update public.garden_slots
    set tile_id = target_tile
    where user_id = uid and plant_id = target_plant_id;
    return;
  end if;

  if occupant_plant is not null then
    update public.garden_slots
    set plant_id = target_plant_id
    where user_id = uid and tile_id = target_tile;
    return;
  end if;

  insert into public.garden_slots (user_id, plant_id, tile_id)
  values (uid, target_plant_id, target_tile);
end;
$$;

create or replace function public.clear_garden_slot(target_col integer, target_row integer)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.garden_slots as slot
  using public.garden_tiles as tile
  where slot.tile_id = tile.id
    and slot.user_id = auth.uid()
    and tile.user_id = auth.uid()
    and tile.col = target_col
    and tile.row = target_row;
end;
$$;

create or replace function public.ensure_starter_garden()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  perform public.seed_starter_garden(auth.uid());
end;
$$;

create or replace function public.buy_garden_tile(target_col integer, target_row integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owned_count integer;
  purchased integer;
  oxygen_cost numeric;
  pollen_cost numeric;
  balance_oxygen numeric;
  balance_pollen numeric;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.seed_starter_garden(uid);

  perform 1
  from public.garden_tiles
  where user_id = uid
  for update;

  if exists (
    select 1 from public.garden_tiles
    where user_id = uid and col = target_col and row = target_row
  ) then
    raise exception 'You already own that plot';
  end if;

  if not exists (
    select 1 from public.garden_tiles as tile
    where tile.user_id = uid
      and (
        (tile.col = target_col and abs(tile.row - target_row) = 1)
        or (tile.row = target_row and abs(tile.col - target_col) = 1)
      )
  ) then
    raise exception 'You can only buy a plot on the edge of your garden';
  end if;

  select count(*) into owned_count
  from public.garden_tiles
  where user_id = uid;

  purchased := greatest(owned_count - 12, 0);
  oxygen_cost := 1000 + 250 * purchased;
  pollen_cost := 100 + 25 * purchased;

  select oxygen, pollen into balance_oxygen, balance_pollen
  from public.user_currency
  where user_id = uid
  for update;

  if balance_oxygen is null or balance_oxygen < oxygen_cost or balance_pollen < pollen_cost then
    raise exception 'Not enough oxygen or pollen';
  end if;

  update public.user_currency
  set oxygen = oxygen - oxygen_cost,
      pollen = pollen - pollen_cost,
      updated_at = now()
  where user_id = uid;

  insert into public.garden_tiles (user_id, col, row)
  values (uid, target_col, target_row);
end;
$$;

revoke all on function public.seed_starter_garden(uuid) from public, anon, authenticated;
grant execute on function public.seed_starter_garden(uuid) to service_role;

revoke all on function public.ensure_starter_garden() from public, anon;
grant execute on function public.ensure_starter_garden() to authenticated, service_role;

revoke all on function public.assign_garden_slot(uuid, integer, integer) from public;
grant execute on function public.assign_garden_slot(uuid, integer, integer) to authenticated, service_role;

revoke all on function public.clear_garden_slot(integer, integer) from public;
grant execute on function public.clear_garden_slot(integer, integer) to authenticated, service_role;

revoke all on function public.buy_garden_tile(integer, integer) from public, anon;
grant execute on function public.buy_garden_tile(integer, integer) to authenticated, service_role;

comment on function public.buy_garden_tile(integer, integer) is
  'Buys one plot that shares an edge with the garden. Oxygen cost is 1000 + 250 per tile already bought. Pollen cost is 100 + 25 per tile already bought.';
