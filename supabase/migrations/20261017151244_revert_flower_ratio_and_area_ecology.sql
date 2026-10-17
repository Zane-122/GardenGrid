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
      and b.growth_mode is not null;
  exception when others then
    raise warning 'seed_plant_baseline_observation failed for plant %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.seed_plant_baseline_observation() from public;
revoke all on function public.seed_plant_baseline_observation() from anon, authenticated;

alter table public.plant_basic_info
  drop column if exists leaf_to_flower_area_ratio,
  drop column if exists mean_flower_area_cm2;

alter table public.plant_health_info
  drop column if exists leaf_to_flower_area_ratio,
  drop column if exists mean_flower_area_cm2;

alter table public.profiles
  drop column if exists garden_latitude,
  drop column if exists garden_longitude;

alter table public.user_currency
  drop column if exists last_pollen_credited_at;

drop table if exists public.area_ecology;