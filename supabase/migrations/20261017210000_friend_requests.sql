create table if not exists public."FriendRequests" (
  id bigint generated always as identity primary key,
  requesting_user uuid not null references public.profiles (id) on delete cascade,
  receiving_user uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  sent_at timestamptz not null default now(),
  constraint "FriendRequests_status_check" check (status in ('pending', 'rejected', 'approved')),
  constraint "FriendRequests_not_self" check (requesting_user <> receiving_user)
);

comment on table public."FriendRequests" is
  'One row per pair of users. Friends are the approved rows where the user is requesting_user or receiving_user.';
comment on column public."FriendRequests".requesting_user is 'Profile that sent the request.';
comment on column public."FriendRequests".receiving_user is 'Profile that received the request.';
comment on column public."FriendRequests".status is 'pending, rejected, or approved.';
comment on column public."FriendRequests".sent_at is 'When the current request was sent.';

create unique index if not exists "FriendRequests_pair_unique"
  on public."FriendRequests" (least(requesting_user, receiving_user), greatest(requesting_user, receiving_user));

create index if not exists "FriendRequests_requesting_user_idx"
  on public."FriendRequests" (requesting_user);

create index if not exists "FriendRequests_receiving_user_idx"
  on public."FriendRequests" (receiving_user);

alter table public."FriendRequests" enable row level security;

create policy "Users can read requests they sent or received"
  on public."FriendRequests"
  for select
  to authenticated
  using (auth.uid() = requesting_user or auth.uid() = receiving_user);

grant select on table public."FriendRequests" to authenticated;
grant select, insert, update, delete on table public."FriendRequests" to service_role;
grant usage, select on sequence public."FriendRequests_id_seq" to service_role;
