create table if not exists public.plant_basic_info (
  plant_id text primary key,
  scientific_name text,
  common_names text[] not null default '{}',
  taxonomy jsonb,
  rank text,
  watering jsonb,
  propagation_methods text[] not null default '{}',
  edible_parts text[] not null default '{}',
  image_url text,
  url text,
  gbif_id bigint,
  inaturalist_id bigint,
  updated_at timestamptz not null default now()
);

comment on table public.plant_basic_info is 'Refreshable Plant.id taxon cache. Update this table without touching plants.';

create table if not exists public.plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plant_id text not null references public.plant_basic_info(plant_id),
  created_at timestamptz not null default now()
);

create index if not exists plants_user_id_idx on public.plants (user_id);
create index if not exists plants_plant_id_idx on public.plants (plant_id);

alter table public.plant_basic_info enable row level security;
alter table public.plants enable row level security;

create policy "Authenticated users can read plant_basic_info"
  on public.plant_basic_info
  for select
  to authenticated
  using (true);

create policy "Users can read their own plants"
  on public.plants
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own plants"
  on public.plants
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete their own plants"
  on public.plants
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select on table public.plant_basic_info to authenticated, service_role;
grant select, insert, delete on table public.plants to authenticated, service_role;
