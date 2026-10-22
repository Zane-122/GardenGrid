-- Members can move or take back the items they gave to a community garden.

create or replace function public.remove_item_from_community(
  owned_item_id uuid,
  target_community uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  gid := public.member_community_garden(target_community);

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  if not exists (
    select 1
    from public.user_shop_items owned
    join public.garden_tiles tile on tile.id = owned.garden_tile_id
    where owned.id = owned_item_id
      and owned.user_id = uid
      and tile.garden_id = gid
  ) then
    raise exception 'You can only take back items you gave to this garden';
  end if;

  delete from public.user_shop_item_plots
  where user_shop_item_id = owned_item_id;

  update public.user_shop_items
  set garden_tile_id = null
  where id = owned_item_id and user_id = uid;
end;
$$;

create or replace function public.move_item_in_community(
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
begin
  gid := public.member_community_garden(target_community);

  perform 1
  from public.garden_tiles
  where garden_id = gid
  for update;

  select owned.rotation, catalog.footprint_cols, catalog.footprint_rows
  into rot, fcols, frows
  from public.user_shop_items owned
  join public.shop_items catalog on catalog.id = owned.shop_item_id
  join public.garden_tiles tile on tile.id = owned.garden_tile_id
  where owned.id = owned_item_id
    and owned.user_id = uid
    and tile.garden_id = gid
  for update of owned;

  if rot is null then
    raise exception 'You can only move items you gave to this garden';
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
      select 1
      from public.user_shop_item_plots plot
      where plot.garden_tile_id = tile.id
        and plot.user_shop_item_id <> owned_item_id
    )
  ) then
    raise exception 'That plot is taken';
  end if;

  select tile.id into anchor
  from public.garden_tiles tile
  where tile.garden_id = gid and tile.col = target_col and tile.row = target_row;

  delete from public.user_shop_item_plots
  where user_shop_item_id = owned_item_id;

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

revoke all on function public.remove_item_from_community(uuid, uuid) from public, anon;
revoke all on function public.move_item_in_community(uuid, uuid, integer, integer) from public, anon;

grant execute on function public.remove_item_from_community(uuid, uuid) to authenticated, service_role;
grant execute on function public.move_item_in_community(uuid, uuid, integer, integer) to authenticated, service_role;
