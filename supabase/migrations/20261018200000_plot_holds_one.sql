-- A plot holds a plant or a shop tile, never both.

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

  update public.user_shop_items
  set garden_tile_id = null
  where user_id = uid and garden_tile_id = target_tile;

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

  delete from public.garden_slots
  where user_id = uid and tile_id = target_tile;

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

revoke all on function public.assign_garden_slot(uuid, integer, integer) from public;
grant execute on function public.assign_garden_slot(uuid, integer, integer) to authenticated, service_role;

revoke all on function public.place_user_shop_item(uuid, integer, integer) from public, anon;
grant execute on function public.place_user_shop_item(uuid, integer, integer) to authenticated, service_role;
