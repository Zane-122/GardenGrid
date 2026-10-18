alter table public.plants
  add column if not exists oxygen_ml numeric not null default 0;

alter table public.plants
  drop constraint if exists plants_oxygen_ml_check;

alter table public.plants
  add constraint plants_oxygen_ml_check check (oxygen_ml >= 0);

comment on column public.plants.oxygen_ml is
  'Lifetime oxygen this plant has produced, in mL. Increases only when an accrual credit is applied.';

drop function if exists public.credit_oxygen(uuid, numeric, timestamptz, timestamptz);

create function public.credit_oxygen(
  p_user_id uuid,
  p_amount numeric,
  p_expected_last timestamptz,
  p_new_last timestamptz,
  p_plant_oxygen jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  applied integer;
begin
  if p_user_id is null or p_amount is null or p_amount < 0 or p_new_last is null then
    return false;
  end if;

  update public.user_currency
  set oxygen = oxygen + p_amount,
      oxygen_accrued_at = p_new_last,
      updated_at = now()
  where user_id = p_user_id
    and oxygen_accrued_at is not distinct from p_expected_last;

  get diagnostics applied = row_count;
  if applied > 0 then
    if p_amount > 0 then
      update public.profiles
      set total_oxygen = total_oxygen + p_amount
      where id = p_user_id;
    end if;

    update public.plants as plant
    set oxygen_ml = plant.oxygen_ml + credit.ml
    from jsonb_to_recordset(coalesce(p_plant_oxygen, '[]'::jsonb)) as credit(plant_id uuid, ml numeric)
    where plant.id = credit.plant_id
      and plant.user_id = p_user_id
      and credit.ml > 0;

    return true;
  end if;

  -- No row was updated. Only a first accrual (no token yet) may create the
  -- row; a stale non-null token must never credit.
  if p_expected_last is null then
    insert into public.user_currency (user_id, oxygen, oxygen_accrued_at)
    values (p_user_id, p_amount, p_new_last)
    on conflict (user_id) do nothing;

    get diagnostics applied = row_count;
    if applied > 0 then
      if p_amount > 0 then
        update public.profiles
        set total_oxygen = total_oxygen + p_amount
        where id = p_user_id;
      end if;

      update public.plants as plant
      set oxygen_ml = plant.oxygen_ml + credit.ml
      from jsonb_to_recordset(coalesce(p_plant_oxygen, '[]'::jsonb)) as credit(plant_id uuid, ml numeric)
      where plant.id = credit.plant_id
        and plant.user_id = p_user_id
        and credit.ml > 0;
    end if;
    return applied > 0;
  end if;

  return false;
end;
$$;

revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz, jsonb) from anon, authenticated;
grant execute on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz, jsonb) to service_role;

comment on function public.credit_oxygen(uuid, numeric, timestamptz, timestamptz, jsonb) is
  'Adds oxygen for a user when oxygen_accrued_at still matches, and adds each plant contribution onto plants.oxygen_ml.';
