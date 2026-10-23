-- A member can take their own plant back off a community garden.
-- The plant stays owned; only the plot assignment is removed.

create or replace function public.remove_plant_from_community(
  target_plant_id uuid,
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
  removed integer := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  gid := public.member_community_garden(target_community);

  delete from public.garden_slots as slot
  using public.garden_tiles as tile, public.plants as owned
  where slot.tile_id = tile.id
    and owned.id = slot.plant_id
    and slot.plant_id = target_plant_id
    and owned.user_id = uid
    and tile.garden_id = gid;

  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'You can only take back plants you placed in this garden';
  end if;
end;
$$;

revoke all on function public.remove_plant_from_community(uuid, uuid) from public, anon;
grant execute on function public.remove_plant_from_community(uuid, uuid) to authenticated, service_role;

comment on function public.remove_plant_from_community(uuid, uuid) is
  'Unplaces the caller''s plant from a community garden they belong to. The plant stays in their inventory.';
