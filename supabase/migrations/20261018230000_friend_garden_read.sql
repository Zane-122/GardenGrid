-- Friends can look at each other's placed garden. Unplaced plants and tiles stay private.

create or replace function public.are_friends(left_user uuid, right_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public."FriendRequests"
    where status = 'approved'
      and (
        (requesting_user = left_user and receiving_user = right_user)
        or (requesting_user = right_user and receiving_user = left_user)
      )
  );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated, service_role;

drop policy if exists "Friends can read each other's garden tiles" on public.garden_tiles;
create policy "Friends can read each other's garden tiles"
  on public.garden_tiles
  for select
  to authenticated
  using (public.are_friends(auth.uid(), user_id));

drop policy if exists "Friends can read each other's garden slots" on public.garden_slots;
create policy "Friends can read each other's garden slots"
  on public.garden_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.garden_tiles tile
      where tile.id = garden_slots.tile_id
        and public.are_friends(auth.uid(), tile.user_id)
    )
  );

drop policy if exists "Friends can read plants placed in a garden" on public.plants;
create policy "Friends can read plants placed in a garden"
  on public.plants
  for select
  to authenticated
  using (
    public.are_friends(auth.uid(), user_id)
    and exists (
      select 1
      from public.garden_slots slot
      where slot.plant_id = plants.id
    )
  );

drop policy if exists "Friends can read placed shop items" on public.user_shop_items;
create policy "Friends can read placed shop items"
  on public.user_shop_items
  for select
  to authenticated
  using (
    garden_tile_id is not null
    and public.are_friends(auth.uid(), user_id)
  );

drop policy if exists "Friends can read plots a friend's item occupies" on public.user_shop_item_plots;
create policy "Friends can read plots a friend's item occupies"
  on public.user_shop_item_plots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_shop_items owned
      where owned.id = user_shop_item_plots.user_shop_item_id
        and owned.garden_tile_id is not null
        and public.are_friends(auth.uid(), owned.user_id)
    )
  );

drop policy if exists "Friends can read photos of plants in a garden" on storage.objects;
create policy "Friends can read photos of plants in a garden"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plant-photos'
    and exists (
      select 1
      from public.plants plant
      join public.garden_slots slot on slot.plant_id = plant.id
      where plant.id::text = name
        and public.are_friends(auth.uid(), plant.user_id)
    )
  );
