create or replace function public.clear_garden_slot(target_col integer, target_row integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  removed integer := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.garden_slots as slot
  using public.garden_tiles as tile
  where slot.tile_id = tile.id
    and slot.user_id = uid
    and tile.garden_id = public.personal_garden_id(uid)
    and tile.col = target_col
    and tile.row = target_row;

  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'Nothing to clear on that plot';
  end if;
end;
$$;

comment on function public.clear_garden_slot(integer, integer) is
  'Unplaces the plant on the caller''s personal garden plot. Raises if that plot has no plant.';
