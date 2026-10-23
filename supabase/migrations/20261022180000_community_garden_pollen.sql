-- Community gardens track pollen the same way they track oxygen:
-- garden total + per-member contribution rows, only for plants sitting on that garden.

alter table public.gardens
  add column if not exists total_pollen numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gardens_total_pollen_nonnegative'
      and conrelid = 'public.gardens'::regclass
  ) then
    alter table public.gardens
      add constraint gardens_total_pollen_nonnegative check (total_pollen >= 0);
  end if;
end;
$$;

comment on column public.gardens.total_pollen is
  'Lifetimeime pollen (mg) produced by plants while they sat on this community garden. Personal gardens stay 0.';

alter table public.community_garden_contributions
  add column if not exists pollen_mg numeric not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'community_garden_contributions_pollen_nonnegative'
      and conrelid = 'public.community_garden_contributions'::regclass
  ) then
    alter table public.community_garden_contributions
      add constraint community_garden_contributions_pollen_nonnegative check (pollen_mg >= 0);
  end if;
end;
$$;

comment on column public.community_garden_contributions.pollen_mg is
  'Pollen (mg) this member''s plants have added while placed on the community garden.';

create or replace function public.gardens_total_pollen_no_decrease()
returns trigger
language plpgsql
as $$
begin
  if new.total_pollen < old.total_pollen then
    raise exception 'Community garden pollen totals can only increase';
  end if;
  return new;
end;
$$;

drop trigger if exists gardens_total_pollen_no_decrease on public.gardens;
create trigger gardens_total_pollen_no_decrease
  before update of total_pollen on public.gardens
  for each row
  execute function public.gardens_total_pollen_no_decrease();

create or replace function public.community_contributions_pollen_no_decrease()
returns trigger
language plpgsql
as $$
begin
  if new.pollen_mg < old.pollen_mg then
    raise exception 'Community garden pollen contributions can only increase';
  end if;
  return new;
end;
$$;

drop trigger if exists community_contributions_pollen_no_decrease on public.community_garden_contributions;
create trigger community_contributions_pollen_no_decrease
  before update of pollen_mg on public.community_garden_contributions
  for each row
  execute function public.community_contributions_pollen_no_decrease();

create or replace function public.credit_community_garden_pollen(
  p_user_id uuid,
  p_plant_pollen jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  plant uuid;
  mg numeric;
  garden uuid;
begin
  if p_plant_pollen is null or jsonb_typeof(p_plant_pollen) <> 'array' then
    return;
  end if;

  for entry in select value from jsonb_array_elements(p_plant_pollen)
  loop
    plant := nullif(entry ->> 'plant_id', '')::uuid;
    mg := nullif(entry ->> 'mg', '')::numeric;
    garden := null;

    if plant is null or mg is null or mg <= 0 then
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
    set total_pollen = total_pollen + mg
    where id = garden;

    insert into public.community_garden_contributions (garden_id, user_id, oxygen_ml, pollen_mg)
    values (garden, p_user_id, 0, mg)
    on conflict (garden_id, user_id)
    do update set pollen_mg = public.community_garden_contributions.pollen_mg + excluded.pollen_mg;
  end loop;
end;
$$;

revoke all on function public.credit_community_garden_pollen(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.credit_community_garden_pollen(uuid, jsonb) to service_role;

comment on function public.credit_community_garden_pollen(uuid, jsonb) is
  'Adds plant milligrams to a community garden pollen total and the owner contribution. Service role only.';


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
  garden_oxygen numeric;
  garden_pollen numeric;
begin
  gid := public.member_community_garden(target_community);

  select community.name, garden.total_oxygen, garden.total_pollen
  into garden_name, garden_oxygen, garden_pollen
  from public.gardens garden
  join public.communities community on community.id = garden.community_id
  where garden.id = gid;

  return jsonb_build_object(
    'name', garden_name,
    'totalOxygen', garden_oxygen,
    'totalPollen', garden_pollen,
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
        'oxygenMl', coalesce(contribution.oxygen_ml, 0),
        'pollenMg', coalesce(contribution.pollen_mg, 0)
      ) order by coalesce(contribution.oxygen_ml, 0) + coalesce(contribution.pollen_mg, 0) desc, profile.display_name)
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
