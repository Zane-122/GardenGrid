-- Idempotent sync of growth-curve + health observation schema (already live on remote).

alter table public.plant_basic_info
  add column if not exists growth_mode text,
  add column if not exists l double precision,
  add column if not exists k double precision,
  add column if not exists x0 double precision,
  add column if not exists xg double precision,
  add column if not exists kg double precision,
  add column if not exists ks double precision,
  add column if not exists xs double precision,
  add column if not exists f double precision,
  add column if not exists r double precision,
  add column if not exists cycle_length double precision,
  add column if not exists b_base double precision,
  add column if not exists l_season double precision,
  add column if not exists carbon_fraction double precision,
  add column if not exists confidence double precision,
  add column if not exists params_generated_at timestamptz;

comment on column public.plant_basic_info.growth_mode is
  'Growth curve mode: annual_bounded | woody_residual | cyclical. Filled lazily by Gemini.';
comment on column public.plant_basic_info.l is
  'Peak/mature leaf area carrying capacity in cm².';

alter table public.plants
  add column if not exists current_x_position double precision,
  add column if not exists last_recalibrated_at timestamptz;

comment on column public.plants.current_x_position is
  'Day position on the species growth curve, resolved from the latest photo fullness.';
comment on column public.plants.last_recalibrated_at is
  'When current_x_position was last set from a photo analysis.';

create table if not exists public.plant_health_info (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants(id) on delete cascade,
  photo_path text,
  observed_at timestamptz not null default now(),
  estimated_fullness_pct double precision,
  estimated_health_score double precision,
  resolved_x_position double precision,
  growth_mode text,
  l double precision,
  k double precision,
  x0 double precision,
  xg double precision,
  kg double precision,
  xs double precision,
  ks double precision,
  f double precision,
  r double precision,
  cycle_length double precision,
  b_base double precision,
  l_season double precision,
  carbon_fraction double precision
);

comment on table public.plant_health_info is
  'Per-observation health/growth snapshots for a plant instance, derived from a submitted photo.';

create index if not exists plant_health_info_plant_id_idx
  on public.plant_health_info (plant_id);

alter table public.plant_health_info enable row level security;

drop policy if exists "Users can read their own plant health info" on public.plant_health_info;
create policy "Users can read their own plant health info"
  on public.plant_health_info for select to authenticated
  using (
    exists (
      select 1 from public.plants p
      where p.id = plant_health_info.plant_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can insert their own plant health info" on public.plant_health_info;
create policy "Users can insert their own plant health info"
  on public.plant_health_info for insert to authenticated
  with check (
    exists (
      select 1 from public.plants p
      where p.id = plant_health_info.plant_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete their own plant health info" on public.plant_health_info;
create policy "Users can delete their own plant health info"
  on public.plant_health_info for delete to authenticated
  using (
    exists (
      select 1 from public.plants p
      where p.id = plant_health_info.plant_id and p.user_id = auth.uid()
    )
  );

grant select, insert, delete on table public.plant_health_info to authenticated, service_role;