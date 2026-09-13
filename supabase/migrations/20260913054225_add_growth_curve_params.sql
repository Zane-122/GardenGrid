alter table public.plant_basic_info
  add column if not exists growth_mode text,
  add column if not exists l double precision,
  add column if not exists k double precision,
  add column if not exists x0 double precision,
  add column if not exists xg double precision,
  add column if not exists kg double precision,
  add column if not exists xs double precision,
  add column if not exists f double precision,
  add column if not exists r double precision,
  add column if not exists cycle_length double precision,
  add column if not exists b_base double precision,
  add column if not exists l_season double precision,
  add column if not exists carbon_fraction double precision,
  add column if not exists confidence double precision,
  add column if not exists params_generated_at timestamptz;

comment on column public.plant_basic_info.growth_mode is 'Which M(x) variant applies: annual_bounded, woody_residual, or cyclical.';
comment on column public.plant_basic_info.l is 'Peak/mature leaf area (cm²) — carrying capacity in the logistic growth term P(x).';
comment on column public.plant_basic_info.k is 'Growth rate constant for the main logistic growth term P(x).';
comment on column public.plant_basic_info.x0 is 'Day of maximum growth rate (inflection point) in P(x).';
comment on column public.plant_basic_info.xg is 'Germination/emergence midpoint day, used in gate term G(x).';
comment on column public.plant_basic_info.kg is 'Germination steepness constant, used in gate term G(x).';
comment on column public.plant_basic_info.xs is 'Mode-dependent: senescence onset day (annual_bounded) or residual-growth start day (woody_residual). Unused in cyclical.';
comment on column public.plant_basic_info.f is 'annual_bounded only: long-term canopy retention floor as a fraction of L.';
comment on column public.plant_basic_info.r is 'woody_residual only: residual growth rate (cm²/day) added after xs.';
comment on column public.plant_basic_info.cycle_length is 'cyclical only: days per growth cycle (e.g. ~365 for annual die-back perennials).';
comment on column public.plant_basic_info.b_base is 'cyclical only: persistent crown/root leaf-area baseline (cm²) that survives dormancy.';
comment on column public.plant_basic_info.l_season is 'cyclical only: new seasonal leaf area regrown each cycle (cm²).';
comment on column public.plant_basic_info.carbon_fraction is 'Fraction of dry biomass that is carbon, used to convert leaf-area growth into CO2/O2 estimates.';
comment on column public.plant_basic_info.confidence is 'Model-reported confidence (0-1) in the generated growth-curve parameters.';
comment on column public.plant_basic_info.params_generated_at is 'When the growth-curve parameters were last (re)generated.';

alter table public.plants
  add column if not exists current_x_position double precision,
  add column if not exists last_recalibrated_at timestamptz;

comment on column public.plants.current_x_position is 'Current position along the fitted growth curve (model input space, not physical size).';
comment on column public.plants.last_recalibrated_at is 'When current_x_position was last recalibrated from an observed photo.';

create table if not exists public.plant_health_info (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  photo_path text,
  observed_at timestamptz not null default now(),
  estimated_fullness_pct double precision,
  estimated_health_score double precision,
  resolved_x_position double precision
);

comment on table public.plant_health_info is 'Per-observation health/growth snapshots for a plant instance, derived from a submitted photo.';

create index if not exists plant_health_info_plant_id_idx on public.plant_health_info (plant_id);

alter table public.plant_health_info enable row level security;

create policy "Users can read their own plant health info"
  on public.plant_health_info
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.plants p
      where p.id = plant_health_info.plant_id
        and p.user_id = auth.uid()
    )
  );

create policy "Users can insert their own plant health info"
  on public.plant_health_info
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.plants p
      where p.id = plant_health_info.plant_id
        and p.user_id = auth.uid()
    )
  );

create policy "Users can delete their own plant health info"
  on public.plant_health_info
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.plants p
      where p.id = plant_health_info.plant_id
        and p.user_id = auth.uid()
    )
  );

grant select, insert, delete on table public.plant_health_info to authenticated, service_role;