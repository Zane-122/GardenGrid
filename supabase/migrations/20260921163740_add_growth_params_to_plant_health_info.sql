alter table public.plant_health_info
  add column if not exists growth_mode text,
  add column if not exists l double precision,
  add column if not exists k double precision,
  add column if not exists x0 double precision,
  add column if not exists xg double precision,
  add column if not exists kg double precision,
  add column if not exists xs double precision,
  add column if not exists ks double precision,
  add column if not exists f double precision,
  add column if not exists r double precision,
  add column if not exists cycle_length double precision,
  add column if not exists b_base double precision,
  add column if not exists l_season double precision,
  add column if not exists carbon_fraction double precision;

comment on column public.plant_health_info.growth_mode is 'Which M(x) variant applies for this observation: annual_bounded, woody_residual, or cyclical.';
comment on column public.plant_health_info.l is 'Peak/mature leaf area (cm²) for this plant, as estimated from this observation.';
comment on column public.plant_health_info.k is 'Growth rate constant for the main logistic growth term P(x), as estimated from this observation.';
comment on column public.plant_health_info.x0 is 'Day of maximum growth rate (inflection point) in P(x), as estimated from this observation.';
comment on column public.plant_health_info.xg is 'Germination/emergence midpoint day, used in gate term G(x).';
comment on column public.plant_health_info.kg is 'Germination steepness constant, used in gate term G(x).';
comment on column public.plant_health_info.xs is 'Mode-dependent: senescence onset day (annual_bounded) or residual-growth start day (woody_residual). Unused in cyclical.';
comment on column public.plant_health_info.f is 'annual_bounded only: long-term canopy retention floor as a fraction of L.';
comment on column public.plant_health_info.r is 'woody_residual only: residual growth rate (cm²/day) added after xs.';
comment on column public.plant_health_info.cycle_length is 'cyclical only: days per growth cycle.';
comment on column public.plant_health_info.b_base is 'cyclical only: persistent crown/root leaf-area baseline (cm²).';
comment on column public.plant_health_info.l_season is 'cyclical only: new seasonal leaf area regrown each cycle (cm²).';
comment on column public.plant_health_info.carbon_fraction is 'Fraction of dry biomass that is carbon, as estimated from this observation.';