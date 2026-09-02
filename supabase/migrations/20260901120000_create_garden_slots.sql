create table if not exists public.garden_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plant_id uuid not null references public.plants(id) on delete cascade,
  slot_index integer not null,
  created_at timestamptz not null default now(),
  constraint garden_slots_slot_index_range check (slot_index >= 0 and slot_index < 12),
  constraint garden_slots_user_slot_unique unique (user_id, slot_index),
  constraint garden_slots_plant_unique unique (plant_id)
);

comment on table public.garden_slots is 'Places a user plant instance into a garden grid slot by index.';
comment on column public.garden_slots.plant_id is 'User-owned plant instance (plants.id), not the Plant.id taxon.';
comment on column public.garden_slots.slot_index is 'Zero-based grid index. 4 columns x 3 rows: 0-11, left to right, top to bottom.';

create index if not exists garden_slots_user_id_idx on public.garden_slots (user_id);

alter table public.garden_slots enable row level security;

create policy "Users can read their own garden slots"
  on public.garden_slots for select to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own garden slots"
  on public.garden_slots for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.plants p
      where p.id = garden_slots.plant_id and p.user_id = auth.uid()
    )
  );

create policy "Users can update their own garden slots"
  on public.garden_slots for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.plants p
      where p.id = garden_slots.plant_id and p.user_id = auth.uid()
    )
  );

create policy "Users can delete their own garden slots"
  on public.garden_slots for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.garden_slots to authenticated, service_role;

create or replace function public.assign_garden_slot(target_plant_id uuid, target_slot_index integer)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing_slot integer;
  occupant_plant uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if target_slot_index < 0 or target_slot_index >= 12 then
    raise exception 'Invalid garden slot index';
  end if;

  if not exists (
    select 1 from public.plants
    where id = target_plant_id and user_id = uid
  ) then
    raise exception 'Plant must belong to you';
  end if;

  select slot_index into existing_slot
  from public.garden_slots
  where user_id = uid and plant_id = target_plant_id;

  select plant_id into occupant_plant
  from public.garden_slots
  where user_id = uid and slot_index = target_slot_index;

  if existing_slot is not null and existing_slot = target_slot_index then
    return;
  end if;

  if existing_slot is not null and occupant_plant is not null then
    delete from public.garden_slots
    where user_id = uid and plant_id in (target_plant_id, occupant_plant);

    insert into public.garden_slots (user_id, plant_id, slot_index)
    values
      (uid, target_plant_id, target_slot_index),
      (uid, occupant_plant, existing_slot);
    return;
  end if;

  if existing_slot is not null then
    update public.garden_slots
    set slot_index = target_slot_index
    where user_id = uid and plant_id = target_plant_id;
    return;
  end if;

  if occupant_plant is not null then
    update public.garden_slots
    set plant_id = target_plant_id
    where user_id = uid and slot_index = target_slot_index;
    return;
  end if;

  insert into public.garden_slots (user_id, plant_id, slot_index)
  values (uid, target_plant_id, target_slot_index);
end;
$$;

create or replace function public.clear_garden_slot(target_slot_index integer)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.garden_slots
  where user_id = auth.uid()
    and slot_index = target_slot_index;
end;
$$;

grant execute on function public.assign_garden_slot(uuid, integer) to authenticated, service_role;
grant execute on function public.clear_garden_slot(integer) to authenticated, service_role;
