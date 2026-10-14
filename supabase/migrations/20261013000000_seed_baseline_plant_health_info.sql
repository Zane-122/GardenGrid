-- Gives every newly added plant a usable leaf area right away by seeding a
-- baseline plant_health_info row from its species growth params, at
-- resolved_x_position = 0 (the start of the curve). Baseline rows have no
-- photo and a null estimated_fullness_pct, which is how update-plant-photo
-- tells them apart from real photo observations.

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
      cycle_length, b_base, l_season, carbon_fraction
    )
    select new.id, new.created_at, 0,
           b.growth_mode, b.l, b.k, b.x0, b.xg, b.kg, b.xs, b.ks, b.f, b.r,
           b.cycle_length, b.b_base, b.l_season, b.carbon_fraction
    from public.plant_basic_info b
    where b.plant_id = new.plant_id
      and b.growth_mode is not null;  -- skip species with no params yet
  exception when others then
    -- Never block adding a plant because the baseline row failed.
    raise warning 'seed_plant_baseline_observation failed for plant %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.seed_plant_baseline_observation() from public;
revoke all on function public.seed_plant_baseline_observation() from anon, authenticated;

drop trigger if exists plants_seed_baseline on public.plants;

create trigger plants_seed_baseline
  after insert on public.plants
  for each row
  execute function public.seed_plant_baseline_observation();

comment on function public.seed_plant_baseline_observation() is
  'Seeds a baseline plant_health_info row (species params, x=0, no photo) when a plant is added.';

-- One-off backfill: existing plants with no plant_health_info row whose
-- species has growth params.
insert into public.plant_health_info (
  plant_id, observed_at, resolved_x_position,
  growth_mode, l, k, x0, xg, kg, xs, ks, f, r,
  cycle_length, b_base, l_season, carbon_fraction
)
select p.id, p.created_at, 0,
       b.growth_mode, b.l, b.k, b.x0, b.xg, b.kg, b.xs, b.ks, b.f, b.r,
       b.cycle_length, b.b_base, b.l_season, b.carbon_fraction
from public.plants p
join public.plant_basic_info b on b.plant_id = p.plant_id
where b.growth_mode is not null
  and not exists (
    select 1 from public.plant_health_info h where h.plant_id = p.id
  );
