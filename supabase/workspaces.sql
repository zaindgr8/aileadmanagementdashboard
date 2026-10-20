-- Workspaces (multi-client). Run after platform.sql and whatsapp.sql. Safe to re-run.
-- Every client gets a workspace; all chats, leads, team members and settings belong to one.
-- Existing data is moved into the primary workspace "ai-founder-hub".

create table if not exists public.workspaces (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name          text not null,
  status        text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  plan          text not null default 'starter',
  modules       text[] not null default '{whatsapp}',
  is_primary    boolean not null default false,          -- the original install; falls back to .env.local keys
  contact_name  text not null default '',
  contact_email text not null default '',
  config        jsonb not null default '{}'::jsonb,      -- non-secret connection settings (Twilio SID, sender, Retell agents)
  secrets       text,                                     -- AES-GCM encrypted JSON (Twilio auth token, Retell key)
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   text
);
create unique index if not exists workspaces_one_primary on public.workspaces (is_primary) where is_primary;
alter table public.workspaces enable row level security;

insert into public.workspaces (id, name, status, plan, modules, is_primary, approved_at, approved_by)
values ('ai-founder-hub', 'AI Founder Hub', 'active', 'scale', '{whatsapp,calls}', true, now(), 'migration')
on conflict (id) do nothing;

-- Add workspace_id to every tenant table and put existing rows in the primary workspace.
do $$
declare t text;
begin
  foreach t in array array['app_users', 'conversations', 'messages', 'agent_events', 'conversation_notes', 'settings', 'call_leads', 'call_campaigns'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'workspace_id') then
      execute format('alter table public.%I add column workspace_id text references public.workspaces (id) on delete cascade', t);
      execute format('update public.%I set workspace_id = %L where workspace_id is null', t, 'ai-founder-hub');
      execute format('alter table public.%I alter column workspace_id set not null', t);
    end if;
  end loop;
end $$;

-- Users: sign in with username or email; platform admins run the whole product.
alter table public.app_users add column if not exists platform_admin boolean not null default false;
create unique index if not exists app_users_email_key on public.app_users (lower(email)) where email is not null and email <> '';
create index if not exists app_users_workspace_idx on public.app_users (workspace_id);

-- The same customer can message two different clients, so chats are keyed by (workspace, id).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'messages_conversation_id_fkey') then
    alter table public.messages drop constraint messages_conversation_id_fkey;
  end if;
  if exists (select 1 from pg_constraint where conname = 'conversation_notes_conversation_id_fkey') then
    alter table public.conversation_notes drop constraint conversation_notes_conversation_id_fkey;
  end if;
  if (select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.conversations'::regclass and i.indisprimary) = 1 then
    alter table public.conversations drop constraint conversations_pkey;
    alter table public.conversations add primary key (workspace_id, id);
  end if;
  if (select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.messages'::regclass and i.indisprimary) = 1 then
    alter table public.messages drop constraint messages_pkey;
    alter table public.messages add primary key (workspace_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_conversation_fkey') then
    alter table public.messages add constraint messages_conversation_fkey
      foreign key (workspace_id, conversation_id) references public.conversations (workspace_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversation_notes_conversation_fkey') then
    alter table public.conversation_notes add constraint conversation_notes_conversation_fkey
      foreign key (workspace_id, conversation_id) references public.conversations (workspace_id, id) on delete cascade;
  end if;
  -- One settings row per workspace (it used to be a single row with id = 1).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'settings' and column_name = 'id') then
    alter table public.settings drop constraint settings_pkey;
    alter table public.settings drop column id;
    alter table public.settings add primary key (workspace_id);
  end if;
  -- Call leads are keyed by (workspace, phone).
  if (select count(*) from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.call_leads'::regclass and i.indisprimary) = 1 then
    alter table public.call_leads drop constraint call_leads_pkey;
    alter table public.call_leads add primary key (workspace_id, phone);
  end if;
end $$;

drop index if exists public.conversations_last_message_at_idx;
drop index if exists public.messages_conversation_created_idx;
drop index if exists public.messages_created_idx;
drop index if exists public.agent_events_at_idx;
drop index if exists public.conversation_notes_conv_idx;
create index if not exists conversations_ws_last_message_idx on public.conversations (workspace_id, last_message_at desc);
create index if not exists messages_ws_conversation_created_idx on public.messages (workspace_id, conversation_id, created_at);
create index if not exists messages_ws_created_idx on public.messages (workspace_id, created_at desc);
create index if not exists agent_events_ws_at_idx on public.agent_events (workspace_id, at desc);
create index if not exists conversation_notes_ws_conv_idx on public.conversation_notes (workspace_id, conversation_id, created_at);
create index if not exists call_campaigns_ws_idx on public.call_campaigns (workspace_id, created_at desc);

-- record_message now takes the workspace.
drop function if exists public.record_message(jsonb, boolean);
create or replace function public.record_message(ws text, m jsonb, count_unread boolean default false)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  conv     text        := m->>'conversationId';
  at       timestamptz := (m->>'createdAt')::timestamptz;
  inbound  boolean     := m->>'direction' = 'inbound';
  preview  text        := coalesce(nullif(m->>'body', ''),
                            case when jsonb_array_length(coalesce(m->'media', '[]'::jsonb)) > 0 then '📎 Media' else '' end);
  inserted boolean;
begin
  insert into conversations (workspace_id, id, phone, last_message_at)
  values (ws, conv, regexp_replace(conv, '^whatsapp:', ''), at)
  on conflict (workspace_id, id) do nothing;

  insert into messages (workspace_id, id, conversation_id, direction, author, body, media, status, error, created_at)
  values (ws, m->>'id', conv, m->>'direction', m->>'author', coalesce(m->>'body', ''),
          coalesce(m->'media', '[]'::jsonb), coalesce(m->>'status', ''), m->>'error', at)
  on conflict (workspace_id, id) do update set
    direction  = excluded.direction,
    author     = excluded.author,
    body       = excluded.body,
    media      = excluded.media,
    status     = excluded.status,
    error      = coalesce(excluded.error, messages.error),
    created_at = excluded.created_at
  returning (xmax = 0) into inserted;

  update conversations c set
    last_message_at      = case when at >= c.last_message_at or c.last_message_preview = '' then at else c.last_message_at end,
    last_message_preview = case when at >= c.last_message_at or c.last_message_preview = '' then preview else c.last_message_preview end,
    last_inbound_at      = case when inbound and (c.last_inbound_at is null or at > c.last_inbound_at) then at else c.last_inbound_at end,
    unread               = c.unread + case when inbound and inserted and count_unread then 1 else 0 end,
    status               = case when inbound and inserted and count_unread then 'open' else c.status end
  where c.workspace_id = ws and c.id = conv;

  return inserted;
end;
$$;
revoke execute on function public.record_message(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_message(text, jsonb, boolean) to service_role;

-- Invite links: one-time, expiring. Only a hash of the token is stored.
create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  email        text not null default '',
  name         text not null default '',
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  modules      text[] not null default '{whatsapp}',
  created_by   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  used_by      text
);
create index if not exists invites_workspace_idx on public.invites (workspace_id, created_at desc);
alter table public.invites enable row level security;

-- Headline numbers per workspace for the admin console.
create or replace function public.workspace_stats()
returns table (workspace_id text, users bigint, conversations bigint, last_activity timestamptz)
language sql stable set search_path = public as $$
  select w.id,
    (select count(*) from app_users u where u.workspace_id = w.id),
    (select count(*) from conversations c where c.workspace_id = w.id),
    (select max(c.last_message_at) from conversations c where c.workspace_id = w.id)
  from workspaces w;
$$;
revoke execute on function public.workspace_stats() from public, anon, authenticated;
grant execute on function public.workspace_stats() to service_role;

-- Make yourself a platform admin (can approve workspaces and open any of them):
-- update public.app_users set platform_admin = true where username = 'your-username';

-- Client self-onboarding: business info, uploaded documents (as extracted text) and agent status.
alter table public.workspaces add column if not exists onboarding jsonb not null default '{}'::jsonb;
