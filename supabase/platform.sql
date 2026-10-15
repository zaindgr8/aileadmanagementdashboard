-- AI Lead Management: platform tables (users) and the Voice calls module.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to re-run.
-- WhatsApp tables are in whatsapp.sql.

-- ---------------------------------------------------------------------------
-- Users. `modules` decides which parts of the product a user can open.
create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique check (username = lower(username)),
  display_name   text not null default '',
  email          text,
  password_hash  text not null,                     -- scrypt$N$r$p$salt$hash (npm run user:hash -- 'pw')
  role           text not null default 'member' check (role in ('owner', 'admin', 'member')),
  modules        text[] not null default '{whatsapp,calls}',
  active         boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Voice calls: what the dashboard knows about each lead (calls themselves stay in Retell).
create table if not exists public.call_leads (
  phone          text primary key,                  -- E.164, e.g. "+971501234567"
  name           text,
  email          text,
  company        text,
  stage          text check (stage in ('new', 'attempted', 'engaged', 'qualified', 'proposal', 'won', 'lost')),
  stage_at       timestamptz,
  value          numeric,
  tags           text[] not null default '{}',
  notes          jsonb not null default '[]'::jsonb, -- [{id, at, text}], newest first
  follow_up_at   timestamptz,
  source         text,
  archived       boolean not null default false,
  brief          jsonb,                             -- AI lead brief
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists call_leads_follow_up_idx on public.call_leads (follow_up_at) where follow_up_at is not null;

-- Bulk call campaigns launched from the dashboard (Retell has no "list batches" API).
create table if not exists public.call_campaigns (
  batch_call_id  text primary key,
  name           text not null default '',
  from_number    text not null default '',
  agent_id       text,
  agent_name     text,
  total          integer not null default 0,
  skipped        integer not null default 0,
  scheduled_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  call_window    jsonb
);
create index if not exists call_campaigns_created_idx on public.call_campaigns (created_at desc);

-- Keep updated_at current.
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists app_users_touch on public.app_users;
create trigger app_users_touch before update on public.app_users for each row execute function public.touch_updated_at();

-- Only the server (secret key) may touch these tables.
alter table public.app_users      enable row level security;
alter table public.call_leads     enable row level security;
alter table public.call_campaigns enable row level security;
