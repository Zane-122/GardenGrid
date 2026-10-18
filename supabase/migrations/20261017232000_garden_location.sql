alter table public.profiles
  add column if not exists garden_latitude double precision,
  add column if not exists garden_longitude double precision;

comment on column public.profiles.garden_latitude is
  'Last known garden latitude, used to look up sunlight from Open-Meteo.';
comment on column public.profiles.garden_longitude is
  'Last known garden longitude, used to look up sunlight from Open-Meteo.';
