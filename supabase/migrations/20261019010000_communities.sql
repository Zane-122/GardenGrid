-- Communities are groups of friends. A person can belong to two at a time,
-- including any they own.

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint communities_name_length check (char_length(name) between 1 and 40)
);

comment on table public.communities is
  'A group owned by one profile. The owner is also a member.';

create table if not exists public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

comment on table public.community_members is
  'People in a community. Membership, owned or not, counts toward the limit of 2.';

create index if not exists community_members_user_id_idx
  on public.community_members (user_id);

create table if not exists public.community_invites (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  inviter_id uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint community_invites_status_check check (status in ('pending', 'accepted', 'declined')),
  constraint community_invites_not_self check (inviter_id <> invitee_id)
);

create unique index if not exists community_invites_one_pending
  on public.community_invites (community_id, invitee_id)
  where status = 'pending';

comment on table public.community_invites is
  'An owner asks a friend to join. Accepting adds a member if they are in fewer than 2 communities.';

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_invites enable row level security;

grant select on table public.communities to authenticated, service_role;
grant select on table public.community_members to authenticated, service_role;
grant select on table public.community_invites to authenticated, service_role;
grant insert, update, delete on table public.communities to service_role;
grant insert, update, delete on table public.community_members to service_role;
grant insert, update, delete on table public.community_invites to service_role;

create or replace function public.community_membership_count(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.community_members
  where user_id = target_user;
$$;

revoke all on function public.community_membership_count(uuid) from public, anon, authenticated;

create or replace function public.list_my_communities()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  return jsonb_build_object(
    'membershipCount', public.community_membership_count(uid),
    'communities', coalesce((
      select jsonb_agg(entry.payload order by entry.owned desc, entry.community_name)
      from (
        select
          (c.owner_id = uid) as owned,
          c.name as community_name,
          jsonb_build_object(
            'id', c.id,
            'name', c.name,
            'owned', c.owner_id = uid,
            'owner', jsonb_build_object(
              'id', owner_profile.id,
              'username', coalesce(owner_profile.username, 'unknown'),
              'displayName', coalesce(nullif(btrim(owner_profile.display_name), ''), owner_profile.username, 'unknown')
            ),
            'members', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', member_profile.id,
                'username', coalesce(member_profile.username, 'unknown'),
                'displayName', coalesce(nullif(btrim(member_profile.display_name), ''), member_profile.username, 'unknown')
              ) order by member_profile.display_name), '[]'::jsonb)
              from public.community_members member
              join public.profiles member_profile on member_profile.id = member.user_id
              where member.community_id = c.id
            ),
            'invites', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', invite.id,
                'person', jsonb_build_object(
                  'id', invitee.id,
                  'username', coalesce(invitee.username, 'unknown'),
                  'displayName', coalesce(nullif(btrim(invitee.display_name), ''), invitee.username, 'unknown')
                )
              ) order by invite.created_at desc), '[]'::jsonb)
              from public.community_invites invite
              join public.profiles invitee on invitee.id = invite.invitee_id
              where invite.community_id = c.id
                and invite.status = 'pending'
                and c.owner_id = uid
            )
          ) as payload
        from public.communities c
        join public.community_members mine
          on mine.community_id = c.id
         and mine.user_id = uid
        join public.profiles owner_profile on owner_profile.id = c.owner_id
      ) entry
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invite.id,
        'communityId', c.id,
        'communityName', c.name,
        'from', jsonb_build_object(
          'id', inviter.id,
          'username', coalesce(inviter.username, 'unknown'),
          'displayName', coalesce(nullif(btrim(inviter.display_name), ''), inviter.username, 'unknown')
        )
      ) order by invite.created_at desc)
      from public.community_invites invite
      join public.communities c on c.id = invite.community_id
      join public.profiles inviter on inviter.id = invite.inviter_id
      where invite.invitee_id = uid
        and invite.status = 'pending'
    ), '[]'::jsonb),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', friend_profile.id,
        'username', coalesce(friend_profile.username, 'unknown'),
        'displayName', coalesce(nullif(btrim(friend_profile.display_name), ''), friend_profile.username, 'unknown')
      ) order by friend_profile.display_name)
      from public.profiles friend_profile
      where public.are_friends(uid, friend_profile.id)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_community(community_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cleaned text := btrim(coalesce(community_name, ''));
  created_id uuid;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if char_length(cleaned) < 1 or char_length(cleaned) > 40 then
    raise exception 'Use a name up to 40 characters';
  end if;

  perform pg_advisory_xact_lock(8421504, hashtext(uid::text));

  if public.community_membership_count(uid) >= 2 then
    raise exception 'You can only be in 2 communities';
  end if;

  insert into public.communities (name, owner_id)
  values (cleaned, uid)
  returning id into created_id;

  insert into public.community_members (community_id, user_id)
  values (created_id, uid);

  return created_id;
end;
$$;

create or replace function public.invite_to_community(target_community uuid, friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if friend_id is null or friend_id = uid then
    raise exception 'Choose a friend to invite';
  end if;

  if not exists (
    select 1 from public.communities
    where id = target_community and owner_id = uid
  ) then
    raise exception 'Only the owner can invite people';
  end if;

  if not public.are_friends(uid, friend_id) then
    raise exception 'You can only invite friends';
  end if;

  if exists (
    select 1 from public.community_members
    where community_id = target_community and user_id = friend_id
  ) then
    raise exception 'They are already in this community';
  end if;

  if exists (
    select 1 from public.community_invites
    where community_id = target_community
      and invitee_id = friend_id
      and status = 'pending'
  ) then
    raise exception 'That invite is already waiting';
  end if;

  perform pg_advisory_xact_lock(8421504, hashtext(friend_id::text));

  if public.community_membership_count(friend_id) >= 2 then
    raise exception 'They can only be in 2 communities';
  end if;

  insert into public.community_invites (community_id, inviter_id, invitee_id, status)
  values (target_community, uid, friend_id, 'pending');
end;
$$;

create or replace function public.respond_to_community_invite(target_invite uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  invite_community uuid;
  invite_status text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select community_id, status
  into invite_community, invite_status
  from public.community_invites
  where id = target_invite and invitee_id = uid
  for update;

  if invite_community is null then
    raise exception 'That invite is not for you';
  end if;

  if invite_status <> 'pending' then
    raise exception 'That invite is already answered';
  end if;

  if accept then
    perform pg_advisory_xact_lock(8421504, hashtext(uid::text));

    if public.community_membership_count(uid) >= 2 then
      raise exception 'You can only be in 2 communities';
    end if;

    insert into public.community_members (community_id, user_id)
    values (invite_community, uid)
    on conflict do nothing;

    update public.community_invites
    set status = 'accepted'
    where id = target_invite;
  else
    update public.community_invites
    set status = 'declined'
    where id = target_invite;
  end if;
end;
$$;

create or replace function public.leave_community(target_community uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1 from public.communities
    where id = target_community and owner_id = uid
  ) then
    raise exception 'Delete this community to leave it';
  end if;

  delete from public.community_members
  where community_id = target_community and user_id = uid;

  if not found then
    raise exception 'You are not in that community';
  end if;
end;
$$;

create or replace function public.delete_community(target_community uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.communities
  where id = target_community and owner_id = uid;

  if not found then
    raise exception 'Only the owner can delete that community';
  end if;
end;
$$;

revoke all on function public.list_my_communities() from public, anon;
revoke all on function public.create_community(text) from public, anon;
revoke all on function public.invite_to_community(uuid, uuid) from public, anon;
revoke all on function public.respond_to_community_invite(uuid, boolean) from public, anon;
revoke all on function public.leave_community(uuid) from public, anon;
revoke all on function public.delete_community(uuid) from public, anon;

grant execute on function public.list_my_communities() to authenticated, service_role;
grant execute on function public.create_community(text) to authenticated, service_role;
grant execute on function public.invite_to_community(uuid, uuid) to authenticated, service_role;
grant execute on function public.respond_to_community_invite(uuid, boolean) to authenticated, service_role;
grant execute on function public.leave_community(uuid) to authenticated, service_role;
grant execute on function public.delete_community(uuid) to authenticated, service_role;

comment on function public.create_community(text) is
  'Creates a community and joins the owner to it. Fails when they already belong to 2.';
comment on function public.invite_to_community(uuid, uuid) is
  'Owner invites a friend who is in fewer than 2 communities.';
