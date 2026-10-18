-- Shop items can cover more than one plot. A bench is 2 by 1 and can be turned.

alter table public.shop_items
  add column if not exists footprint_cols integer not null default 1 check (footprint_cols > 0),
  add column if not exists footprint_rows integer not null default 1 check (footprint_rows > 0);

alter table public.user_shop_items
  add column if not exists rotation smallint not null default 0;

alter table public.user_shop_items
  drop constraint if exists user_shop_items_rotation_check;

alter table public.user_shop_items
  add constraint user_shop_items_rotation_check
  check (rotation in (0, 90, 180, 270));

create table if not exists public.user_shop_item_plots (
  user_shop_item_id uuid not null references public.user_shop_items(id) on delete cascade,
  garden_tile_id uuid not null references public.garden_tiles(id) on delete cascade,
  primary key (user_shop_item_id, garden_tile_id)
);

create unique index if not exists user_shop_item_plots_one_item
  on public.user_shop_item_plots (garden_tile_id);

drop index if exists public.user_shop_items_one_per_plot;

comment on column public.shop_items.footprint_cols is
  'Plots wide before rotation. Rotation by 90 degrees swaps the two axes.';
comment on column public.user_shop_items.rotation is
  'Quarter turns clockwise from the catalog art. 0 faces the art as drawn.';
comment on table public.user_shop_item_plots is
  'Every plot a placed item occupies. One plot can belong to only one item.';

alter table public.user_shop_item_plots enable row level security;

drop policy if exists "Users can read plots their items occupy" on public.user_shop_item_plots;
create policy "Users can read plots their items occupy"
  on public.user_shop_item_plots for select to authenticated
  using (
    exists (
      select 1 from public.user_shop_items owned
      where owned.id = user_shop_item_id and owned.user_id = auth.uid()
    )
  );

grant select on table public.user_shop_item_plots to authenticated;
grant select, insert, update, delete on table public.user_shop_item_plots to service_role;

insert into public.user_shop_item_plots (user_shop_item_id, garden_tile_id)
select id, garden_tile_id
from public.user_shop_items
where garden_tile_id is not null
on conflict do nothing;

insert into public.shop_items (slug, name, description, oxygen_cost, image_path, footprint_cols, footprint_rows)
values (
  'bench',
  'Bench',
  'A wooden bench that sits across two plots. Turn it to lay it the other way.',
  5000,
  'bench.png',
  2,
  1
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    oxygen_cost = excluded.oxygen_cost,
    image_path = excluded.image_path,
    footprint_cols = excluded.footprint_cols,
    footprint_rows = excluded.footprint_rows;

create or replace function public.shop_item_cells(
  anchor_col integer,
  anchor_row integer,
  footprint_cols integer,
  footprint_rows integer,
  rotation integer
)
returns table(cell_col integer, cell_row integer)
language sql
immutable
as $$
  select anchor_col + dx.n, anchor_row + dy.n
  from generate_series(
    0,
    case when rotation in (90, 270) then footprint_rows else footprint_cols end - 1
  ) as dx(n)
  cross join generate_series(
    0,
    case when rotation in (90, 270) then footprint_cols else footprint_rows end - 1
  ) as dy(n);
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

  expected := fcols * frows;

  select count(*) into found_tiles
  from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
  join public.garden_tiles tile
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row;

  if found_tiles <> expected then
    raise exception 'That does not fit on your garden';
  end if;

  select tile.id into anchor
  from public.garden_tiles tile
  where tile.user_id = uid and tile.col = target_col and tile.row = target_row;

  if old_anchor is not null and not exists (
    select 1
    from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    join public.garden_tiles tile
      on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
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
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
  where slot.user_id = uid;

  select count(distinct plot.user_shop_item_id) into other_count
  from public.user_shop_item_plots plot
  join public.garden_tiles tile on tile.id = plot.garden_tile_id
  join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
  where plot.user_shop_item_id <> owned_item_id;

  swap_plant := null;
  swap_item := null;

  if old_anchor is not null
    and not exists (
      select 1
      from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      join public.garden_tiles tile
        on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
      where tile.id = old_anchor
    )
    and plant_count = 1
    and other_count = 0
  then
    select slot.plant_id into swap_plant
    from public.garden_slots slot
    join public.garden_tiles tile on tile.id = slot.tile_id
    join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
    where slot.user_id = uid;
  elsif old_anchor is not null
    and not exists (
      select 1
      from public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      join public.garden_tiles tile
        on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
      where tile.id = old_anchor
    )
    and plant_count = 0
    and other_count = 1
  then
    select plot.user_shop_item_id into swap_item
    from public.user_shop_item_plots plot
    join public.garden_tiles tile on tile.id = plot.garden_tile_id
    join public.shop_item_cells(target_col, target_row, fcols, frows, rot) cell
      on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
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
          on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
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
          on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
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
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row;

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
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row;

  if found_tiles <> expected then
    raise exception 'Not enough room to turn that';
  end if;

  if exists (
    select 1
    from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
    join public.garden_tiles tile
      on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
    join public.user_shop_item_plots plot on plot.garden_tile_id = tile.id
    where plot.user_shop_item_id <> owned_item_id
  ) or exists (
    select 1
    from public.shop_item_cells(anchor_col, anchor_row, fcols, frows, next_rot) cell
    join public.garden_tiles tile
      on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row
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
    on tile.user_id = uid and tile.col = cell.cell_col and tile.row = cell.cell_row;
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

revoke all on function public.shop_item_cells(integer, integer, integer, integer, integer) from public;
grant execute on function public.shop_item_cells(integer, integer, integer, integer, integer) to authenticated, service_role;

revoke all on function public.rotate_user_shop_item(uuid) from public, anon;
grant execute on function public.rotate_user_shop_item(uuid) to authenticated, service_role;

revoke all on function public.place_user_shop_item(uuid, integer, integer) from public, anon;
grant execute on function public.place_user_shop_item(uuid, integer, integer) to authenticated, service_role;

revoke all on function public.clear_user_shop_item(uuid) from public, anon;
grant execute on function public.clear_user_shop_item(uuid) to authenticated, service_role;

revoke all on function public.assign_garden_slot(uuid, integer, integer) from public, anon;
grant execute on function public.assign_garden_slot(uuid, integer, integer) to authenticated, service_role;
