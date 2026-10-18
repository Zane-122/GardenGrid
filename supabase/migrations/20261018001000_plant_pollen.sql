alter table public.plants
  add column if not exists pollen_mg numeric not null default 0;

alter table public.plants
  drop constraint if exists plants_pollen_mg_check;

alter table public.plants
  add constraint plants_pollen_mg_check check (pollen_mg >= 0);

comment on column public.plants.pollen_mg is
  'Lifetime pollen this plant has produced, in mg. Increases only when a pollen credit is applied.';

-- The only credits so far are one interval of flower_count * pollen_per_flower_mg.
update public.plants
set pollen_mg = flower_count * pollen_per_flower_mg
where last_pollen_credited_at is not null
  and flower_count is not null
  and pollen_per_flower_mg is not null
  and flower_count > 0
  and pollen_per_flower_mg > 0;

drop function if exists public.credit_user_pollen(uuid, numeric);

create function public.credit_user_pollen(
  target_user_id uuid,
  amount numeric,
  plant_pollen jsonb default '[]'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if amount is null or amount <= 0 then
    select pollen into new_balance from public.user_currency where user_id = target_user_id;
    return coalesce(new_balance, 0);
  end if;

  insert into public.user_currency (user_id)
  values (target_user_id)
  on conflict (user_id) do nothing;

  update public.user_currency
  set pollen = pollen + amount,
      updated_at = now()
  where user_id = target_user_id
  returning pollen into new_balance;

  update public.profiles
  set total_pollen = total_pollen + amount
  where id = target_user_id;

  update public.plants as plant
  set pollen_mg = plant.pollen_mg + credit.mg
  from jsonb_to_recordset(coalesce(plant_pollen, '[]'::jsonb)) as credit(plant_id uuid, mg numeric)
  where plant.id = credit.plant_id
    and plant.user_id = target_user_id
    and credit.mg > 0;

  return new_balance;
end;
$$;

revoke all on function public.credit_user_pollen(uuid, numeric, jsonb) from public;
revoke all on function public.credit_user_pollen(uuid, numeric, jsonb) from anon, authenticated;
grant execute on function public.credit_user_pollen(uuid, numeric, jsonb) to service_role;

comment on function public.credit_user_pollen(uuid, numeric, jsonb) is
  'Adds pollen to the user balance and lifetime total, and adds each plant contribution onto plants.pollen_mg.';
