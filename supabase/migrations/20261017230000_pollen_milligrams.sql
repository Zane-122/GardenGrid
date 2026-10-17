-- Stored pollen was cubic centimeters. Treat 1 cm³ as 1 g, which is 1000 mg.
-- The column rename makes a second run skip the conversion.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plants'
      and column_name = 'pollen_per_flower_cm3'
  ) then
    alter table public.plants rename column pollen_per_flower_cm3 to pollen_per_flower_mg;
    update public.plants
    set pollen_per_flower_mg = pollen_per_flower_mg * 1000
    where pollen_per_flower_mg is not null;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'plant_health_info'
        and column_name = 'pollen_per_flower_cm3'
    ) then
      alter table public.plant_health_info rename column pollen_per_flower_cm3 to pollen_per_flower_mg;
      update public.plant_health_info
      set pollen_per_flower_mg = pollen_per_flower_mg * 1000
      where pollen_per_flower_mg is not null;
    end if;

    update public.user_currency
    set pollen = pollen * 1000;

    update public.profiles
    set total_pollen = total_pollen * 1000;
  end if;
end $$;

comment on column public.plants.pollen_per_flower_mg is
  'Milligrams of pollen one flower produces over 8 hours.';

comment on column public.plant_health_info.pollen_per_flower_mg is
  'Milligrams of pollen one flower produces over 8 hours, recorded with this observation.';

comment on column public.user_currency.pollen is
  'Spendable pollen balance in milligrams.';

comment on column public.profiles.total_pollen is
  'Milligrams of pollen ever earned. Increases when pollen is credited and never goes down when currency is spent.';
