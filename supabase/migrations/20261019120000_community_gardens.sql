-- A garden is either one person's or one community's. Plots point at a garden.
-- Lifetime oxygen on a community garden is a scoreboard and only increases.

create table if not exists public.gardens (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  owner_id uuid references public.profiles (id) on delete cascade,
  community_id uuid references public.communities (id) on delete cascade,
  total_oxygen numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint gardens_kind_check check (kind in ('personal', 'community')),
  constraint gardens_total_oxygen_nonnegative check (total_oxygen >= 0),
  constraint gardens_kind_shape check (
    (kind = 'personal' and owner_id is not null and community_id is null)
    or (kind = 'community' and community_id is not null and owner_id is null)
  )
);

create unique index if not exists gardens_one_personal_idx
  on public.gardens (owner_id)
  where kind = 'personal';

create unique index if not exists gardens_one_community_idx
  on public.gardens (community_id)
  where kind = 'community';

comment on table public.gardens is
  'One personal garden per profile, or one community garden per community.';
comment on column public.gardens.total_oxygen is
  'Lifetime milliliters produced by plants on this garden. It only increases and is not spendable.';

alter table public.gardens enable row level security;

grant select on table public.gardens to authenticated, service_role;
grant insert, update, delete on table public.gardens to service_role;

drop policy if exists "People can read gardens they belong to" on public.gardens;
create policy "People can read gardens they belong to"
  on public.gardens
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    or public.are_friends(auth.uid(), owner_id)
    or exists (
      select 1
      from public.community_members member
      where member.community_id = gardens.community_id
        and member.user_id = auth.uid()
    )
  );

insert into public.gardens (kind, owner_id)
select 'personal', profile.id
from public.profiles profile
on conflict (owner_id) where kind = 'personal' do nothing;

alter table public.garden_tiles
  add column if not exists garden_id uuid references public.gardens (id) on delete cascade;

update public.garden_tiles tile
set garden_id = garden.id
from public.gardens garden
where garden.kind = 'personal'
  and garden.owner_id = tile.user_id
  and tile.garden_id is null;

do $$
begin
  if exists (select 1 from public.garden_tiles where garden_id is null) then
    raise exception 'A garden plot could not be linked to a personal garden';
  end if;
end $$;

alter table public.garden_tiles
  alter column garden_id set not null;

alter table public.garden_tiles
  drop constraint if exists garden_tiles_user_coord_unique;

alter table public.garden_tiles
  add constraint garden_tiles_garden_coord_unique unique (garden_id, col, row);

create index if not exists garden_tiles_garden_id_idx on public.garden_tiles (garden_id);

comment on column public.garden_tiles.garden_id is
  'The garden this plot belongs to. user_id is who paid for it.';
comment on column public.garden_tiles.user_id is
  'Who paid for this plot. Starter plots are paid for by the garden founder.';

create table if not exists public.community_garden_contributions (
  garden_id uuid not null references public.gardens (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  oxygen_ml numeric not null default 0,
  primary key (garden_id, user_id),
  constraint community_garden_contributions_nonnegative check (oxygen_ml >= 0)
);

comment on table public.community_garden_contributions is
  'Milliliters a member''s plants have added to one community garden. It only increases.';

alter table public.community_garden_contributions enable row level security;

grant select on table public.community_garden_contributions to authenticated, service_role;
grant insert, update, delete on table public.community_garden_contributions to service_role;

drop policy if exists "Members can read community garden contributions" on public.community_garden_contributions;
create policy "Members can read community garden contributions"
  on public.community_garden_contributions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.gardens garden
      join public.community_members member on member.community_id = garden.community_id
      where garden.id = community_garden_contributions.garden_id
        and member.user_id = auth.uid()
    )
  );

create or replace function public.gardens_total_oxygen_no_decrease()
returns trigger
language plpgsql
as $$
begin
  if new.total_oxygen < old.total_oxygen then
    raise exception 'Garden oxygen total cannot decrease';
  end if;
  return new;
end;
$$;

drop trigger if exists gardens_total_oxygen_no_decrease on public.gardens;
create trigger gardens_total_oxygen_no_decrease
  before update of total_oxygen on public.gardens
  for each row
  execute function public.gardens_total_oxygen_no_decrease();

create or replace function public.community_contributions_no_decrease()
returns trigger
language plpgsql
as $$
begin
  if new.oxygen_ml < old.oxygen_ml then
    raise exception 'Community contribution cannot decrease';
  end if;
  return new;
end;
$$;

drop trigger if exists community_contributions_no_decrease on public.community_garden_contributions;
create trigger community_contributions_no_decrease
  before update of oxygen_ml on public.community_garden_contributions
  for each row
  execute function public.community_contributions_no_decrease();

create or replace function public.personal_garden_id(target_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.gardens
  where kind = 'personal'
    and owner_id = target_user;
$$;

revoke all on function public.personal_garden_id(uuid) from public, anon, authenticated;
grant execute on function public.personal_garden_id(uuid) to service_role;

create or replace function public.seed_garden_plots(target_garden uuid, payer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.garden_tiles (user_id, garden_id, col, row)
  select payer, target_garden, col, row
  from generate_series(0, 2) as col
  cross join generate_series(0, 3) as row
  on conflict (garden_id, col, row) do nothing;
end;
$$;

revoke all on function public.seed_garden_plots(uuid, uuid) from public, anon, authenticated;
grant execute on function public.seed_garden_plots(uuid, uuid) to service_role;

create or replace function public.seed_starter_garden(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
begin
  insert into public.gardens (kind, owner_id)
  values ('personal', target_user)
  on conflict (owner_id) where kind = 'personal' do nothing;

  select id into gid
  from public.gardens
  where kind = 'personal'
    and owner_id = target_user;

  perform public.seed_garden_plots(gid, target_user);
end;
$$;

create or replace function public.ensure_community_garden(target_community uuid, founder uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
begin
  insert into public.gardens (kind, community_id)
  values ('community', target_community)
  on conflict (community_id) where kind = 'community' do nothing;

  select id into gid
  from public.gardens
  where kind = 'community'
    and community_id = target_community;

  perform public.seed_garden_plots(gid, founder);
  return gid;
end;
$$;

revoke all on function public.ensure_community_garden(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ensure_community_garden(uuid, uuid) to service_role;

do $$
declare
  community_row record;
begin
  for community_row in
    select id, owner_id from public.communities
  loop
    perform public.ensure_community_garden(community_row.id, community_row.owner_id);
  end loop;
end $$;

create or replace function public.member_community_garden(target_community uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select garden.id into gid
  from public.gardens garden
  join public.community_members member
    on member.community_id = garden.community_id
   and member.user_id = uid
  where garden.kind = 'community'
    and garden.community_id = target_community;

  if gid is null then
    raise exception 'You are not in that community';
  end if;

  return gid;
end;
$$;

revoke all on function public.member_community_garden(uuid) from public, anon, authenticated;
grant execute on function public.member_community_garden(uuid) to service_role;

create or replace function public.buy_garden_tiles(targets jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  n integer;
  i integer;
  target jsonb;
  cell_col integer;
  cell_row integer;
  key text;
  seen text[] := array[]::text[];
  cols integer[] := array[]::integer[];
  cell_rows integer[] := array[]::integer[];
  owned_keys text[];
  pending text[];
  found text;
  candidate text;
  owned_count integer;
  purchased integer;
  oxygen_total numeric := 0;
  pollen_total numeric := 0;
  balance_oxygen numeric;
  balance_pollen numeric;
  neighbor_col integer;
  neighbor_row integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if targets is null or jsonb_typeof(targets) <> 'array' or jsonb_array_length(targets) = 0 then
    raise exception 'Choose at least one plot';
  end if;

  n := jsonb_array_length(targets);
  if n > 36 then
    raise exception 'Buy fewer plots at once';
  end if;

  for i in 0 .. n - 1 loop
    target := targets -> i;
    cell_col := (target ->> 'col')::integer;
    cell_row := (target ->> 'row')::integer;
    if cell_col is null or cell_row is null then
      raise exception 'Choose a plot';
    end if;
    key := cell_col::text || ':' || cell_row::text;
    if key = any (seen) then
      raise exception 'That plot is listed twice';
    end if;
    seen := array_append(seen, key);
    cols := array_append(cols, cell_col);
    cell_rows := array_append(cell_rows, cell_row);
  end loop;

  perform public.seed_starter_garden(uid);
  gid := public.personal_garden_id(uid);

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  if exists (
    select 1
    from public.garden_tiles as tile
    where tile.garden_id = gid
      and (tile.col::text || ':' || tile.row::text) = any (seen)
  ) then
    raise exception 'You already own that plot';
  end if;

  select coalesce(array_agg(tile.col::text || ':' || tile.row::text), array[]::text[]), count(*)
  into owned_keys, owned_count
  from public.garden_tiles as tile
  where tile.garden_id = gid;

  pending := seen;
  while cardinality(pending) > 0 loop
    found := null;
    foreach candidate in array pending loop
      neighbor_col := split_part(candidate, ':', 1)::integer;
      neighbor_row := split_part(candidate, ':', 2)::integer;
      if (neighbor_col::text || ':' || (neighbor_row - 1)::text) = any (owned_keys)
        or (neighbor_col::text || ':' || (neighbor_row + 1)::text) = any (owned_keys)
        or ((neighbor_col - 1)::text || ':' || neighbor_row::text) = any (owned_keys)
        or ((neighbor_col + 1)::text || ':' || neighbor_row::text) = any (owned_keys)
      then
        found := candidate;
        exit;
      end if;
    end loop;

    if found is null then
      raise exception 'You can only buy a plot on the edge of your garden';
    end if;

    purchased := greatest(owned_count - 12, 0);
    oxygen_total := oxygen_total + (1000 + 250 * purchased);
    pollen_total := pollen_total + (100 + 25 * purchased);
    owned_count := owned_count + 1;
    owned_keys := array_append(owned_keys, found);
    pending := array_remove(pending, found);
  end loop;

  select oxygen, pollen into balance_oxygen, balance_pollen
  from public.user_currency
  where user_id = uid
  for update;

  if balance_oxygen is null or balance_oxygen < oxygen_total or balance_pollen < pollen_total then
    raise exception 'Not enough oxygen or pollen';
  end if;

  update public.user_currency
  set oxygen = oxygen - oxygen_total,
      pollen = pollen - pollen_total,
      updated_at = now()
  where user_id = uid;

  insert into public.garden_tiles (user_id, garden_id, col, row)
  select uid, gid, cell.cell_col, cell.cell_row
  from unnest(cols, cell_rows) as cell(cell_col, cell_row);
end;
$$;

create or replace function public.buy_garden_tile(target_col integer, target_row integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.buy_garden_tiles(
    jsonb_build_array(jsonb_build_object('col', target_col, 'row', target_row))
  );
end;
$$;

create or replace function public.clear_garden_slot(target_col integer, target_row integer)
returns void
language plpgsql
security definer
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
    and tile.garden_id = public.personal_garden_id(auth.uid())
    and tile.col = target_col
    and tile.row = target_row;
end;
$$;

create or replace function public.create_community(community_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(community_name, ''));
  created_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if char_length(cleaned) < 1 or char_length(cleaned) > 40 then
    raise exception 'Use a name up to 40 characters';
  end if;

  perform pg_advisory_xact_lock(8421504, hashtext(uid::text));

  if public.community_membership_count(uid) >= 2 then
    raise exception 'You can only be in 2 communities';
  end if;

  insert into public.communities (name, owner_id)
  values (cleaned, uid)
  returning id into created_id;

  insert into public.community_members (community_id, user_id)
  values (created_id, uid);

  perform public.ensure_community_garden(created_id, uid);

  return created_id;
end;
$$;

comment on function public.create_community(text) is
  'Creates a community, joins the owner, and seeds its garden with 12 plots.';

create or replace function public.buy_community_plots(target_community uuid, targets jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  n integer;
  i integer;
  target jsonb;
  cell_col integer;
  cell_row integer;
  key text;
  seen text[] := array[]::text[];
  cols integer[] := array[]::integer[];
  cell_rows integer[] := array[]::integer[];
  owned_keys text[];
  pending text[];
  found text;
  candidate text;
  owned_count integer;
  purchased integer;
  oxygen_total numeric := 0;
  pollen_total numeric := 0;
  balance_oxygen numeric;
  balance_pollen numeric;
  neighbor_col integer;
  neighbor_row integer;
begin
  gid := public.member_community_garden(target_community);

  if targets is null or jsonb_typeof(targets) <> 'array' or jsonb_array_length(targets) = 0 then
    raise exception 'Choose at least one plot';
  end if;

  n := jsonb_array_length(targets);
  if n > 36 then
    raise exception 'Buy fewer plots at once';
  end if;

  for i in 0 .. n - 1 loop
    target := targets -> i;
    cell_col := (target ->> 'col')::integer;
    cell_row := (target ->> 'row')::integer;
    if cell_col is null or cell_row is null then
      raise exception 'Choose a plot';
    end if;
    key := cell_col::text || ':' || cell_row::text;
    if key = any (seen) then
      raise exception 'That plot is listed twice';
    end if;
    seen := array_append(seen, key);
    cols := array_append(cols, cell_col);
    cell_rows := array_append(cell_rows, cell_row);
  end loop;

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  if exists (
    select 1
    from public.garden_tiles as tile
    where tile.garden_id = gid
      and (tile.col::text || ':' || tile.row::text) = any (seen)
  ) then
    raise exception 'That plot is already part of the garden';
  end if;

  select coalesce(array_agg(tile.col::text || ':' || tile.row::text), array[]::text[]), count(*)
  into owned_keys, owned_count
  from public.garden_tiles as tile
  where tile.garden_id = gid;

  pending := seen;
  while cardinality(pending) > 0 loop
    found := null;
    foreach candidate in array pending loop
      neighbor_col := split_part(candidate, ':', 1)::integer;
      neighbor_row := split_part(candidate, ':', 2)::integer;
      if (neighbor_col::text || ':' || (neighbor_row - 1)::text) = any (owned_keys)
        or (neighbor_col::text || ':' || (neighbor_row + 1)::text) = any (owned_keys)
        or ((neighbor_col - 1)::text || ':' || neighbor_row::text) = any (owned_keys)
        or ((neighbor_col + 1)::text || ':' || neighbor_row::text) = any (owned_keys)
      then
        found := candidate;
        exit;
      end if;
    end loop;

    if found is null then
      raise exception 'You can only buy a plot on the edge of the garden';
    end if;

    purchased := greatest(owned_count - 12, 0);
    oxygen_total := oxygen_total + (1000 + 250 * purchased);
    pollen_total := pollen_total + (100 + 25 * purchased);
    owned_count := owned_count + 1;
    owned_keys := array_append(owned_keys, found);
    pending := array_remove(pending, found);
  end loop;

  select oxygen, pollen into balance_oxygen, balance_pollen
  from public.user_currency
  where user_id = uid
  for update;

  if balance_oxygen is null or balance_oxygen < oxygen_total or balance_pollen < pollen_total then
    raise exception 'Not enough oxygen or pollen';
  end if;

  update public.user_currency
  set oxygen = oxygen - oxygen_total,
      pollen = pollen - pollen_total,
      updated_at = now()
  where user_id = uid;

  insert into public.garden_tiles (user_id, garden_id, col, row)
  select uid, gid, cell.cell_col, cell.cell_row
  from unnest(cols, cell_rows) as cell(cell_col, cell_row);
end;
$$;

create or replace function public.donate_item_to_community(
  owned_item_id uuid,
  target_community uuid,
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
  gid uuid;
  rot integer;
  fcols integer;
  frows integer;
  expected integer;
  found_tiles bigint;
  anchor uuid;
  current_tile uuid;
begin
  gid := public.member_community_garden(target_community);

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  select owned.rotation, catalog.footprint_cols, catalog.footprint_rows, owned.garden_tile_id
  into rot, fcols, frows, current_tile
  from public.user_shop_items owned
  join public.shop_items catalog on catalog.id = owned.shop_item_id
  where owned.id = owned_item_id and owned.user_id = uid
  for update;

  if rot is null then
    raise exception 'You do not own that item';
  end if;

  if current_tile is not null then
    raise exception 'Pick an item that is not already placed';
  end if;

  expected := fcols * frows;

  select count(*) into found_tiles
  from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
  join public.garden_tiles tile
    on tile.garden_id = gid and tile.col = cell.cell_col and tile.row = cell.cell_row;

  if found_tiles <> expected then
    raise exception 'That does not fit on the community garden';
  end if;

  if exists (
    select 1
    from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    join public.garden_tiles tile
      on tile.garden_id = gid and tile.col = cell.cell_col and tile.row = cell.cell_row
    where exists (
      select 1 from public.garden_slots slot where slot.tile_id = tile.id
    )
    or exists (
      select 1 from public.user_shop_item_plots plot where plot.garden_tile_id = tile.id
    )
  ) then
    raise exception 'That plot is taken';
  end if;

  select tile.id into anchor
  from public.garden_tiles tile
  where tile.garden_id = gid and tile.col = target_col and tile.row = target_row;

  insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
  select owned_item_id, tile.id
  from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
  join public.garden_tiles tile
    on tile.garden_id = gid and tile.col = cell.cell_col and tile.row = cell.cell_row;

  update public.user_shop_items
  set garden_tile_id = anchor
  where id = owned_item_id;
end;
$$;

create or replace function public.place_plant_in_community_garden(
  target_plant_id uuid,
  target_community uuid,
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
  gid uuid;
  target_tile uuid;
begin
  gid := public.member_community_garden(target_community);

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  if not exists (
    select 1 from public.plants
    where id = target_plant_id and user_id = uid
  ) then
    raise exception 'Plant must belong to you';
  end if;

  if exists (
    select 1 from public.garden_slots
    where plant_id = target_plant_id
  ) then
    raise exception 'That plant is already in a garden';
  end if;

  select id into target_tile
  from public.garden_tiles
  where garden_id = gid and col = target_col and row = target_row;

  if target_tile is null then
    raise exception 'That plot is not part of the community garden';
  end if;

  if exists (
    select 1 from public.garden_slots where tile_id = target_tile
  ) or exists (
    select 1 from public.user_shop_item_plots where garden_tile_id = target_tile
  ) then
    raise exception 'That plot is taken';
  end if;

  insert into public.garden_slots (user_id, plant_id, tile_id)
  values (uid, target_plant_id, target_tile);
end;
$$;

create or replace function public.get_community_garden(target_community uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  garden_name text;
  garden_total numeric;
begin
  gid := public.member_community_garden(target_community);

  select community.name, garden.total_oxygen
  into garden_name, garden_total
  from public.gardens garden
  join public.communities community on community.id = garden.community_id
  where garden.id = gid;

  return jsonb_build_object(
    'name', garden_name,
    'totalOxygen', garden_total,
    'tiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tile.id,
        'col', tile.col,
        'row', tile.row
      ) order by tile.row, tile.col)
      from public.garden_tiles tile
      where tile.garden_id = gid
    ), '[]'::jsonb),
    'plants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', plant.id,
        'name', coalesce(nullif(info.common_names[1], ''), info.scientific_name, 'Plant'),
        'col', tile.col,
        'row', tile.row,
        'ownerId', owner.id,
        'ownerName', coalesce(nullif(btrim(owner.display_name), ''), owner.username, 'unknown'),
        'photoPath', plant.photo_path,
        'imageUrl', info.image_url
      ) order by tile.row, tile.col)
      from public.garden_slots slot
      join public.garden_tiles tile on tile.id = slot.tile_id
      join public.plants plant on plant.id = slot.plant_id
      join public.profiles owner on owner.id = plant.user_id
      left join public.plant_basic_info info on info.plant_id = plant.plant_id
      where tile.garden_id = gid
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', owned.id,
        'name', catalog.name,
        'slug', catalog.slug,
        'imagePath', catalog.image_path,
        'col', tile.col,
        'row', tile.row,
        'rotation', owned.rotation,
        'footprintCols', catalog.footprint_cols,
        'footprintRows', catalog.footprint_rows,
        'ownerId', owner.id,
        'ownerName', coalesce(nullif(btrim(owner.display_name), ''), owner.username, 'unknown')
      ) order by tile.row, tile.col)
      from public.user_shop_items owned
      join public.garden_tiles tile on tile.id = owned.garden_tile_id
      join public.shop_items catalog on catalog.id = owned.shop_item_id
      join public.profiles owner on owner.id = owned.user_id
      where tile.garden_id = gid
    ), '[]'::jsonb),
    'contributions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', member.user_id,
        'displayName', coalesce(nullif(btrim(profile.display_name), ''), profile.username, 'unknown'),
        'oxygenMl', coalesce(contribution.oxygen_ml, 0)
      ) order by coalesce(contribution.oxygen_ml, 0) desc, profile.display_name)
      from public.community_members member
      join public.profiles profile on profile.id = member.user_id
      left join public.community_garden_contributions contribution
        on contribution.garden_id = gid
       and contribution.user_id = member.user_id
      where member.community_id = target_community
    ), '[]'::jsonb),
    'kitPlants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', plant.id,
        'name', coalesce(nullif(info.common_names[1], ''), info.scientific_name, 'Plant'),
        'photoPath', plant.photo_path,
        'imageUrl', info.image_url
      ) order by plant.created_at)
      from public.plants plant
      left join public.plant_basic_info info on info.plant_id = plant.plant_id
      where plant.user_id = uid
        and not exists (
          select 1 from public.garden_slots slot where slot.plant_id = plant.id
        )
    ), '[]'::jsonb),
    'kitItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', owned.id,
        'name', catalog.name,
        'slug', catalog.slug,
        'imagePath', catalog.image_path,
        'rotation', owned.rotation,
        'footprintCols', catalog.footprint_cols,
        'footprintRows', catalog.footprint_rows
      ) order by owned.created_at)
      from public.user_shop_items owned
      join public.shop_items catalog on catalog.id = owned.shop_item_id
      where owned.user_id = uid
        and owned.garden_tile_id is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.credit_community_garden_oxygen(
  p_user_id uuid,
  p_plant_oxygen jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  plant uuid;
  ml numeric;
  garden uuid;
begin
  if p_plant_oxygen is null or jsonb_typeof(p_plant_oxygen) <> 'array' then
    return;
  end if;

  for entry in select value from jsonb_array_elements(p_plant_oxygen)
  loop
    plant := nullif(entry ->> 'plant_id', '')::uuid;
    ml := nullif(entry ->> 'ml', '')::numeric;
    garden := null;

    if plant is null or ml is null or ml <= 0 then
      continue;
    end if;

    select garden_row.id into garden
    from public.garden_slots slot
    join public.garden_tiles tile on tile.id = slot.tile_id
    join public.gardens garden_row on garden_row.id = tile.garden_id
    join public.plants owned on owned.id = slot.plant_id
    where slot.plant_id = plant
      and owned.user_id = p_user_id
      and garden_row.kind = 'community';

    if garden is null then
      continue;
    end if;

    update public.gardens
    set total_oxygen = total_oxygen + ml
    where id = garden;

    insert into public.community_garden_contributions (garden_id, user_id, oxygen_ml)
    values (garden, p_user_id, ml)
    on conflict (garden_id, user_id)
    do update set oxygen_ml = public.community_garden_contributions.oxygen_ml + excluded.oxygen_ml;
  end loop;
end;
$$;

revoke all on function public.buy_community_plots(uuid, jsonb) from public, anon;
revoke all on function public.donate_item_to_community(uuid, uuid, integer, integer) from public, anon;
revoke all on function public.place_plant_in_community_garden(uuid, uuid, integer, integer) from public, anon;
revoke all on function public.get_community_garden(uuid) from public, anon;
revoke all on function public.credit_community_garden_oxygen(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.buy_community_plots(uuid, jsonb) to authenticated, service_role;
grant execute on function public.donate_item_to_community(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.place_plant_in_community_garden(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.get_community_garden(uuid) to authenticated, service_role;
grant execute on function public.credit_community_garden_oxygen(uuid, jsonb) to service_role;

comment on function public.buy_community_plots(uuid, jsonb) is
  'A member buys edge plots for a community garden. Spendable oxygen and pollen are charged. Lifetime totals are not reduced.';
comment on function public.donate_item_to_community(uuid, uuid, integer, integer) is
  'Moves one unplaced shop copy onto an empty community plot. It cannot return to a personal garden.';
comment on function public.place_plant_in_community_garden(uuid, uuid, integer, integer) is
  'Places a plant on an empty community plot when that plant is not already in any garden.';
comment on function public.credit_community_garden_oxygen(uuid, jsonb) is
  'Adds plant milliliters to a community garden total and the owner contribution. Service role only.';

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
  rot integer;
  fcols integer;
  frows integer;
  expected integer;
  found_tiles bigint;
  anchor uuid;
  old_anchor uuid;
  plant_count bigint;
  other_count bigint;
  swap_plant uuid;
  swap_item uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select owned.rotation, catalog.footprint_cols, catalog.footprint_rows, owned.garden_tile_id
  into rot, fcols, frows, old_anchor
  from public.user_shop_items owned
  join public.shop_items catalog on catalog.id = owned.shop_item_id
  where owned.id = owned_item_id and owned.user_id = uid
  for update;

  if rot is null then
    raise exception 'You do not own that item';
  end if;

  if exists (
    select 1
    from public.user_shop_items owned_here
    join public.garden_tiles placed on placed.id = owned_here.garden_tile_id
    join public.gardens garden on garden.id = placed.garden_id
    where owned_here.id = owned_item_id
      and garden.kind = 'community'
  ) then
    raise exception 'That item was given to a community garden';
  end if;

  expected := fcols * frows;

  select count(*) into found_tiles
  from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
  join public.garden_tiles tile
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row;

  if found_tiles <> expected then
    raise exception 'That does not fit on your garden';
  end if;

  select tile.id into anchor
  from public.garden_tiles tile
  where tile.garden_id = public.personal_garden_id(uid) and tile.col = target_col and tile.row = target_row;

  if old_anchor is not null and not exists (
    select 1
    from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    join public.garden_tiles tile
      on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
    where not exists (
      select 1 from public.user_shop_item_plots plot
      where plot.user_shop_item_id = owned_item_id and plot.garden_tile_id = tile.id
    )
  ) and (
    select count(*)
    from public.user_shop_item_plots plot
    where plot.user_shop_item_id = owned_item_id
  ) = expected then
    return;
  end if;

  select count(*) into plant_count
  from public.garden_slots slot
  join public.garden_tiles tile on tile.id = slot.tile_id
  join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
  where slot.user_id = uid;

  select count(distinct plot.user_shop_item_id) into other_count
  from public.user_shop_item_plots plot
  join public.garden_tiles tile on tile.id = plot.garden_tile_id
  join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
  where plot.user_shop_item_id <> owned_item_id;

  swap_plant := null;
  swap_item := null;

  if old_anchor is not null
    and not exists (
      select 1
      from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      join public.garden_tiles tile
        on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
      where tile.id = old_anchor
    )
    and plant_count = 1
    and other_count = 0
  then
    select slot.plant_id into swap_plant
    from public.garden_slots slot
    join public.garden_tiles tile on tile.id = slot.tile_id
    join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
    where slot.user_id = uid;
  elsif old_anchor is not null
    and not exists (
      select 1
      from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      join public.garden_tiles tile
        on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
      where tile.id = old_anchor
    )
    and plant_count = 0
    and other_count = 1
  then
    select plot.user_shop_item_id into swap_item
    from public.user_shop_item_plots plot
    join public.garden_tiles tile on tile.id = plot.garden_tile_id
    join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
    where plot.user_shop_item_id <> owned_item_id
    group by plot.user_shop_item_id
    having count(*) = 1
      and (
        select count(*)
        from public.user_shop_item_plots whole
        where whole.user_shop_item_id = plot.user_shop_item_id
      ) = 1;
  end if;

  if swap_plant is not null then
    update public.garden_slots
    set tile_id = old_anchor
    where user_id = uid and plant_id = swap_plant;
  else
    delete from public.garden_slots slot
    where slot.user_id = uid
      and slot.tile_id in (
        select tile.id
        from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
        join public.garden_tiles tile
          on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
      );
  end if;

  delete from public.user_shop_item_plots
  where user_shop_item_id = owned_item_id;

  if swap_item is not null then
    delete from public.user_shop_item_plots where user_shop_item_id = swap_item;
    insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
    values (swap_item, old_anchor);
    update public.user_shop_items set garden_tile_id = old_anchor where id = swap_item;
  else
    update public.user_shop_items displaced
    set garden_tile_id = null
    where displaced.user_id = uid
      and displaced.id <> owned_item_id
      and displaced.id in (
        select plot.user_shop_item_id
        from public.user_shop_item_plots plot
        join public.garden_tiles tile on tile.id = plot.garden_tile_id
        join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
          on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
      );

    delete from public.user_shop_item_plots plot
    where plot.user_shop_item_id in (
      select displaced.id
      from public.user_shop_items displaced
      where displaced.user_id = uid
        and displaced.id <> owned_item_id
        and displaced.garden_tile_id is null
        and exists (
          select 1 from public.user_shop_item_plots still
          where still.user_shop_item_id = displaced.id
        )
    );
  end if;

  delete from public.user_shop_item_plots
  where user_shop_item_id = owned_item_id;

  insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
  select owned_item_id, tile.id
  from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
  join public.garden_tiles tile
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row;

  update public.user_shop_items
  set garden_tile_id = anchor
  where id = owned_item_id;
end;
$$;

create or replace function public.rotate_user_shop_item(owned_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rot integer;
  next_rot integer;
  fcols integer;
  frows integer;
  anchor_col integer;
  anchor_row integer;
  expected integer;
  found_tiles bigint;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select owned.rotation, catalog.footprint_cols, catalog.footprint_rows, tile.col, tile.row
  into rot, fcols, frows, anchor_col, anchor_row
  from public.user_shop_items owned
  join public.shop_items catalog on catalog.id = owned.shop_item_id
  left join public.garden_tiles tile on tile.id = owned.garden_tile_id
  where owned.id = owned_item_id and owned.user_id = uid
  for update;

  if rot is null then
    raise exception 'You do not own that item';
  end if;

  if exists (
    select 1
    from public.user_shop_items owned_here
    join public.garden_tiles placed on placed.id = owned_here.garden_tile_id
    join public.gardens garden on garden.id = placed.garden_id
    where owned_here.id = owned_item_id
      and garden.kind = 'community'
  ) then
    raise exception 'That item was given to a community garden';
  end if;

  next_rot := (rot + 90) % 360;

  if anchor_col is null then
    update public.user_shop_items
    set rotation = next_rot
    where id = owned_item_id;
    return;
  end if;

  select case when next_rot in (90, 270) then frows * fcols else fcols * frows end
  into expected;

  select count(*) into found_tiles
  from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
  join public.garden_tiles tile
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row;

  if found_tiles <> expected then
    raise exception 'Not enough room to turn that';
  end if;

  if exists (
    select 1
    from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
    join public.garden_tiles tile
      on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
    join public.user_shop_item_plots plot on plot.garden_tile_id = tile.id
    where plot.user_shop_item_id <> owned_item_id
  ) or exists (
    select 1
    from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
    join public.garden_tiles tile
      on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row
    join public.garden_slots slot on slot.tile_id = tile.id and slot.user_id = uid
  ) then
    raise exception 'Not enough room to turn that';
  end if;

  update public.user_shop_items
  set rotation = next_rot
  where id = owned_item_id;

  delete from public.user_shop_item_plots
  where user_shop_item_id = owned_item_id;

  insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
  select owned_item_id, tile.id
  from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
  join public.garden_tiles tile
    on tile.garden_id = public.personal_garden_id(uid) and tile.col = cell.cell_col and tile.row = cell.cell_row;
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


  if exists (
    select 1
    from public.user_shop_items owned_here
    join public.garden_tiles placed on placed.id = owned_here.garden_tile_id
    join public.gardens garden on garden.id = placed.garden_id
    where owned_here.id = owned_item_id
      and garden.kind = 'community'
  ) then
    raise exception 'That item was given to a community garden';
  end if;

  delete from public.user_shop_item_plots plot
  using public.user_shop_items owned
  where plot.user_shop_item_id = owned.id
    and owned.id = owned_item_id
    and owned.user_id = auth.uid();

  update public.user_shop_items
  set garden_tile_id = null
  where id = owned_item_id and user_id = auth.uid();

  if not found then
    raise exception 'You do not own that item';
  end if;
end;
$$;

create or replace function public.assign_garden_slot(
  target_plant_id uuid,
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
  existing_tile uuid;
  occupant_plant uuid;
  occupant_item uuid;
  occupant_span bigint;
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

  if exists (
    select 1
    from public.garden_slots slot
    join public.garden_tiles placed on placed.id = slot.tile_id
    join public.gardens garden on garden.id = placed.garden_id
    where slot.plant_id = target_plant_id
      and garden.kind = 'community'
  ) then
    raise exception 'That plant is already in a community garden';
  end if;

  select id into target_tile
  from public.garden_tiles
  where garden_id = public.personal_garden_id(uid) and col = target_col and row = target_row;

  if target_tile is null then
    raise exception 'That plot is not part of your garden';
  end if;

  select tile_id into existing_tile
  from public.garden_slots
  where user_id = uid and plant_id = target_plant_id;

  select plant_id into occupant_plant
  from public.garden_slots
  where user_id = uid and tile_id = target_tile;

  select plot.user_shop_item_id into occupant_item
  from public.user_shop_item_plots plot
  where plot.garden_tile_id = target_tile;

  if occupant_item is not null then
    select count(*) into occupant_span
    from public.user_shop_item_plots
    where user_shop_item_id = occupant_item;
  end if;

  if existing_tile is not null and existing_tile = target_tile then
    if occupant_item is not null then
      delete from public.user_shop_item_plots where user_shop_item_id = occupant_item;
      update public.user_shop_items set garden_tile_id = null where id = occupant_item;
    end if;
    return;
  end if;

  if occupant_item is not null then
    delete from public.user_shop_item_plots where user_shop_item_id = occupant_item;
    update public.user_shop_items set garden_tile_id = null where id = occupant_item;

    if occupant_span = 1
      and occupant_plant is null
      and existing_tile is not null
      and existing_tile <> target_tile then
      insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
      values (occupant_item, existing_tile);
      update public.user_shop_items set garden_tile_id = existing_tile where id = occupant_item;
    end if;
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
