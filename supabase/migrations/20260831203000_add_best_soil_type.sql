alter table public.plant_basic_info
  add column if not exists best_soil_type text;

comment on column public.plant_basic_info.best_soil_type is 'Plant.id best_soil_type paragraph.';
