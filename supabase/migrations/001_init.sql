-- Chorezilla v1
-- Family timetable, check-ins, and a weekly prize.
-- Run this once in the Supabase SQL editor (or via the CLI) on a new project.
--
-- Scoring matches site/scoring.js and is enforced again here so a browser
-- cannot write its own point total:
--   done    = full slot points
--   partial = half, rounded half up (Postgres round on numeric)
--   missed  = 0
-- Minutes wasted are derived in the app from duration_minutes + status.
-- The invite code is the household key. Anyone with it can join.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  role text not null check (role in ('parent', 'kid')),
  emoji text not null default '🦖' check (char_length(emoji) between 1 and 8),
  color text not null default '#2f7d46',
  created_at timestamptz not null default now()
);

-- One login belongs to one household in v1. Unclaimed profiles keep a null user.
create unique index members_one_family_per_user
  on public.members (user_id)
  where user_id is not null;

create index members_family_idx on public.members (family_id);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  days smallint[] not null check (
    cardinality(days) > 0
    and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  start_time time not null,
  end_time time not null,
  points int not null check (points between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index slots_family_idx on public.slots (family_id);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  slot_id uuid not null references public.slots (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  day date not null,
  status text not null check (status in ('done', 'partial', 'missed')),
  points_possible int not null default 0 check (points_possible >= 0),
  points_awarded int not null default 0 check (points_awarded >= 0),
  duration_minutes int not null default 0 check (duration_minutes >= 0),
  reported_role text not null check (reported_role in ('parent', 'kid')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slot_id, day),
  check (points_awarded <= points_possible)
);

create index checkins_family_day_idx on public.checkins (family_id, day);

create table public.prizes (
  family_id uuid not null references public.families (id) on delete cascade,
  week_start date not null,
  prize text not null check (char_length(btrim(prize)) between 1 and 140),
  updated_at timestamptz not null default now(),
  primary key (family_id, week_start),
  check (extract(isodow from week_start) = 1)
);

-- ---------------------------------------------------------------------------
-- Helpers. Security definer so policies can ask "which family am I in?"
-- without recursing through row level security. Do not force RLS on these
-- tables: the definer is the owner and needs to bypass it.
-- ---------------------------------------------------------------------------

create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.members where user_id = auth.uid() limit 1
$$;

create or replace function public.my_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.members where user_id = auth.uid() limit 1
$$;

create or replace function public.am_parent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where user_id = auth.uid() and role = 'parent'
  )
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Copy the slot onto the check-in and overwrite points. Kids cannot pick a total.
create or replace function public.apply_checkin_score()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pts int;
  dur int;
  fam uuid;
  mem uuid;
begin
  select s.points,
         (extract(epoch from (s.end_time - s.start_time)) / 60)::int,
         s.family_id,
         s.member_id
    into pts, dur, fam, mem
  from public.slots s
  where s.id = new.slot_id;

  if fam is null then
    raise exception 'slot not found';
  end if;

  if tg_op = 'UPDATE' and old.approved and not public.am_parent() then
    raise exception 'a parent already checked this one';
  end if;

  new.family_id := fam;
  new.member_id := mem;
  new.points_possible := pts;
  new.duration_minutes := dur;
  if new.status = 'done' then
    new.points_awarded := pts;
  elsif new.status = 'partial' then
    new.points_awarded := round(pts * 0.5)::int;
  else
    new.points_awarded := 0;
  end if;

  if not public.am_parent() then
    new.approved := false;
    new.reported_role := 'kid';
  elsif new.reported_role is null then
    new.reported_role := 'parent';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger checkins_score
  before insert or update on public.checkins
  for each row execute function public.apply_checkin_score();

create trigger prizes_touch
  before update on public.prizes
  for each row execute function public.touch_updated_at();

create or replace function public.slot_member_in_family()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.members m
    where m.id = new.member_id and m.family_id = new.family_id
  ) then
    raise exception 'member is not in this family';
  end if;
  return new;
end;
$$;

create trigger slots_same_family
  before insert or update on public.slots
  for each row execute function public.slot_member_in_family();

create or replace function public.keep_a_parent()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'parent' and not exists (
    select 1 from public.members
    where family_id = old.family_id and role = 'parent' and id <> old.id
  ) then
    raise exception 'the family needs a parent';
  end if;
  return old;
end;
$$;

create trigger members_keep_parent
  before delete on public.members
  for each row execute function public.keep_a_parent();

create or replace function public.keep_a_parent_update()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'parent' and new.role <> 'parent' and not exists (
    select 1 from public.members
    where family_id = old.family_id and role = 'parent' and id <> old.id
  ) then
    raise exception 'the family needs a parent';
  end if;
  return new;
end;
$$;

create trigger members_keep_parent_update
  before update on public.members
  for each row execute function public.keep_a_parent_update();

-- ---------------------------------------------------------------------------
-- Household setup. Direct inserts cannot attach an arbitrary auth user.
-- ---------------------------------------------------------------------------

create or replace function public.create_family(p_name text, p_display_name text, p_emoji text default '🦖')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  fam public.families;
  mem public.members;
  code text;
  made boolean := false;
  i int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'you are already in a family';
  end if;
  if char_length(btrim(p_name)) = 0 or char_length(btrim(p_display_name)) = 0 then
    raise exception 'name required';
  end if;

  for i in 1..8 loop
    code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.families (name, invite_code)
      values (btrim(p_name), code)
      returning * into fam;
      made := true;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  if not made then
    raise exception 'could not make an invite code';
  end if;

  insert into public.members (family_id, user_id, display_name, role, emoji)
  values (fam.id, auth.uid(), btrim(p_display_name), 'parent', coalesce(nullif(btrim(p_emoji), ''), '🦖'))
  returning * into mem;

  return json_build_object('family', row_to_json(fam), 'member', row_to_json(mem));
end;
$$;

create or replace function public.lookup_invite(p_code text)
returns table(family_id uuid, family_name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name
  from public.families
  where invite_code = upper(btrim(p_code))
$$;

create or replace function public.join_family(
  p_code text,
  p_display_name text,
  p_role text,
  p_claim uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  fam public.families;
  mem public.members;
  wanted text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'you are already in a family';
  end if;

  select * into fam from public.families where invite_code = upper(btrim(p_code));
  if not found then
    raise exception 'invite code not found';
  end if;

  if p_claim is not null then
    select * into mem
    from public.members
    where id = p_claim and family_id = fam.id and user_id is null
    for update;
    if not found then
      raise exception 'that profile is gone';
    end if;
    update public.members
      set user_id = auth.uid()
      where id = mem.id
      returning * into mem;
  else
    wanted := case when p_role = 'parent' then 'parent' else 'kid' end;
    if char_length(btrim(coalesce(p_display_name, ''))) = 0 then
      raise exception 'name required';
    end if;
    insert into public.members (family_id, user_id, display_name, role, emoji)
    values (
      fam.id,
      auth.uid(),
      btrim(p_display_name),
      wanted,
      case when wanted = 'parent' then '🦖' else '🦊' end
    )
    returning * into mem;
  end if;

  return json_build_object('family', row_to_json(fam), 'member', row_to_json(mem));
end;
$$;

create or replace function public.unclaimed_profiles(p_code text)
returns table(member_id uuid, display_name text, role text, emoji text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.display_name, m.role, m.emoji
  from public.members m
  join public.families f on f.id = m.family_id
  where f.invite_code = upper(btrim(p_code))
    and m.user_id is null
$$;

create or replace function public.regenerate_invite()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
  fid uuid;
begin
  if not public.am_parent() then
    raise exception 'parents only';
  end if;
  fid := public.my_family_id();
  code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  update public.families set invite_code = code where id = fid;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security. A family only sees its own rows.
-- ---------------------------------------------------------------------------

alter table public.families enable row level security;
alter table public.members enable row level security;
alter table public.slots enable row level security;
alter table public.checkins enable row level security;
alter table public.prizes enable row level security;

create policy families_select on public.families
  for select to authenticated
  using (id = public.my_family_id());

create policy families_update on public.families
  for update to authenticated
  using (id = public.my_family_id() and public.am_parent())
  with check (id = public.my_family_id() and public.am_parent());

create policy members_select on public.members
  for select to authenticated
  using (family_id = public.my_family_id());

-- Profiles a parent adds stay unclaimed until join_family sets user_id.
create policy members_insert on public.members
  for insert to authenticated
  with check (
    family_id = public.my_family_id()
    and public.am_parent()
    and user_id is null
  );

create policy members_update on public.members
  for update to authenticated
  using (family_id = public.my_family_id() and public.am_parent())
  with check (family_id = public.my_family_id() and public.am_parent());

create policy members_delete on public.members
  for delete to authenticated
  using (
    family_id = public.my_family_id()
    and public.am_parent()
    and user_id is distinct from auth.uid()
  );

create policy slots_select on public.slots
  for select to authenticated
  using (family_id = public.my_family_id());

create policy slots_write on public.slots
  for all to authenticated
  using (family_id = public.my_family_id() and public.am_parent())
  with check (family_id = public.my_family_id() and public.am_parent());

create policy checkins_select on public.checkins
  for select to authenticated
  using (family_id = public.my_family_id());

create policy checkins_insert on public.checkins
  for insert to authenticated
  with check (
    family_id = public.my_family_id()
    and (public.am_parent() or member_id = public.my_member_id())
  );

create policy checkins_update on public.checkins
  for update to authenticated
  using (
    family_id = public.my_family_id()
    and (public.am_parent() or member_id = public.my_member_id())
  )
  with check (
    family_id = public.my_family_id()
    and (public.am_parent() or member_id = public.my_member_id())
  );

create policy prizes_select on public.prizes
  for select to authenticated
  using (family_id = public.my_family_id());

create policy prizes_write on public.prizes
  for all to authenticated
  using (family_id = public.my_family_id() and public.am_parent())
  with check (family_id = public.my_family_id() and public.am_parent());

-- ---------------------------------------------------------------------------
-- Grants. The anon key can sign people in. It cannot read rows until then.
-- ---------------------------------------------------------------------------

revoke all on public.families, public.members, public.slots, public.checkins, public.prizes from anon;
revoke all on public.families, public.members, public.slots, public.checkins, public.prizes from public;

grant select, update on public.families to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.slots to authenticated;
grant select, insert, update on public.checkins to authenticated;
grant select, insert, update, delete on public.prizes to authenticated;

revoke all on function public.my_family_id() from public;
revoke all on function public.my_member_id() from public;
revoke all on function public.am_parent() from public;
revoke all on function public.create_family(text, text, text) from public;
revoke all on function public.lookup_invite(text) from public;
revoke all on function public.join_family(text, text, text, uuid) from public;
revoke all on function public.unclaimed_profiles(text) from public;
revoke all on function public.regenerate_invite() from public;

grant execute on function public.my_family_id() to authenticated;
grant execute on function public.my_member_id() to authenticated;
grant execute on function public.am_parent() to authenticated;
grant execute on function public.create_family(text, text, text) to authenticated;
grant execute on function public.lookup_invite(text) to authenticated;
grant execute on function public.unclaimed_profiles(text) to authenticated;
grant execute on function public.join_family(text, text, text, uuid) to authenticated;
grant execute on function public.regenerate_invite() to authenticated;
