create table if not exists public.plant_watering_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plant_id uuid not null references public.plants(id) on delete cascade,
  watered_on date not null,
  created_at timestamptz not null default now(),
  constraint plant_watering_logs_plant_day_unique unique (plant_id, watered_on)
);

comment on table public.plant_watering_logs is 'One row per plant per calendar day the user marked it watered.';
comment on column public.plant_watering_logs.plant_id is 'User-owned plant instance (plants.id), not the Plant.id taxon.';
comment on column public.plant_watering_logs.watered_on is 'Local calendar day the plant was marked watered.';

create index if not exists plant_watering_logs_user_day_idx
  on public.plant_watering_logs (user_id, watered_on);

alter table public.plant_watering_logs enable row level security;

create policy "Users can read their own watering logs"
  on public.plant_watering_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own watering logs"
  on public.plant_watering_logs
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.plants p
      where p.id = plant_watering_logs.plant_id
        and p.user_id = auth.uid()
    )
  );

grant select, insert on table public.plant_watering_logs to authenticated, service_role;