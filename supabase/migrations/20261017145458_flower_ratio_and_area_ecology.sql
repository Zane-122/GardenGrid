-- Species flower traits used to turn leaf area into a flower count, plus a
-- location cache for bee observations and daily sunlight.

alter table public.plant_basic_info
  add column if not exists leaf_to_flower_area_ratio double precision,
  add column if not exists mean_flower_area_cm2 double precision;

comment on column public.plant_basic_info.leaf_to_flower_area_ratio is
  'Mature leaf area divided by flower area at peak bloom. 0 means the species does not flower.';
comment on column public.plant_basic_info.mean_flower_area_cm2 is
  'Typical area of one open flower in cm². Null when the species does not flower.';

alter table public.plant_health_info
  add column if not exists leaf_to_flower_area_ratio double precision,
  add column if not exists mean_flower_area_cm2 double precision;

alter table public.profiles
  add column if not exists garden_latitude double precision,
  add column if not exists garden_longitude double precision;

comment on column public.profiles.garden_latitude is
  'Last known garden latitude, written by garden-ecology from the device GPS.';
comment on column public.profiles.garden_longitude is
  'Last known garden longitude, written by garden-ecology from the device GPS.';

alter table public.user_currency
  add column if not exists last_pollen_credited_at timestamptz;

comment on column public.user_currency.last_pollen_credited_at is
  'When pollen was last accrued from the garden pollen-per-day rate.';

create table if not exists public.area_ecology (
  id uuid primary key default gen_random_uuid(),
  lat_key double precision not null,
  lng_key double precision not null,
  radius_km double precision not null,
  bee_observation_count integer,
  bee_species_count integer,
  bee_fetched_at timestamptz,
  sunlight_mj double precision,
  sunlight_fetched_at timestamptz,
  unique (lat_key, lng_key, radius_km)
);

comment on table public.area_ecology is
  'Cached iNaturalist bee counts and Open-Meteo daily sunlight for a rounded garden location.';

alter table public.area_ecology enable row level security;

revoke all on table public.area_ecology from anon, authenticated;
grant select, insert, update, delete on table public.area_ecology to service_role;

create or replace function public.seed_plant_baseline_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.plant_health_info (
      plant_id, observed_at, resolved_x_position,
      growth_mode, l, k, x0, xg, kg, xs, ks, f, r,
      cycle_length, b_base, l_season, carbon_fraction,
      leaf_to_flower_area_ratio, mean_flower_area_cm2
    )
    select new.id, new.created_at, 0,
           b.growth_mode, b.l, b.k, b.x0, b.xg, b.kg, b.xs, b.ks, b.f, b.r,
           b.cycle_length, b.b_base, b.l_season, b.carbon_fraction,
           b.leaf_to_flower_area_ratio, b.mean_flower_area_cm2
    from public.plant_basic_info b
    where b.plant_id = new.plant_id
      and b.growth_mode is not null;
  exception when others then
    raise warning 'seed_plant_baseline_observation failed for plant %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.seed_plant_baseline_observation() from public;
revoke all on function public.seed_plant_baseline_observation() from anon, authenticated;