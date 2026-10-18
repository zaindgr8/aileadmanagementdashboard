-- WhatsApp dashboard storage. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.

create table if not exists public.conversations (
  id                   text primary key,             -- "whatsapp:+15551234567"
  phone                text not null default '',
  profile_name         text not null default '',
  name                 text not null default '',
  ai_enabled           boolean not null default true,
  needs_human          boolean not null default false,
  handoff_reason       text,
  status               text not null default 'open',
  unread               integer not null default 0,
  tags                 text[] not null default '{}',
  notes                text not null default '',
  last_message_at      timestamptz not null default now(),
  last_message_preview text not null default '',
  last_inbound_at      timestamptz,
  created_at           timestamptz not null default now(),
  lead                 jsonb
);
create index if not exists conversations_last_message_at_idx on public.conversations (last_message_at desc);

create table if not exists public.messages (
  id              text primary key,                  -- Twilio Message SID (or a local id)
  conversation_id text not null references public.conversations (id) on delete cascade,
  direction       text not null,
  author          text not null,
  body            text not null default '',
  media           jsonb not null default '[]'::jsonb,
  status          text not null default '',
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index if not exists messages_created_idx on public.messages (created_at desc);

create table if not exists public.agent_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  at              timestamptz not null default now(),
  type            text not null,
  detail          text not null default '',
  model           text,
  latency_ms      integer,
  input_tokens    integer,
  output_tokens   integer
);
create index if not exists agent_events_at_idx on public.agent_events (at desc);

create table if not exists public.settings (
  id   integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);

-- Only the server (secret key) may touch these tables; the publishable key gets nothing.
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.agent_events  enable row level security;
alter table public.settings      enable row level security;

-- Save a message and update its chat's summary in one step, so two webhooks
-- arriving together can't overwrite each other's unread count or preview.
-- Returns true when the message is new.
create or replace function public.record_message(m jsonb, count_unread boolean default false)
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
  insert into conversations (id, phone, last_message_at)
  values (conv, regexp_replace(conv, '^whatsapp:', ''), at)
  on conflict (id) do nothing;

  insert into messages (id, conversation_id, direction, author, body, media, status, error, created_at)
  values (m->>'id', conv, m->>'direction', m->>'author', coalesce(m->>'body', ''),
          coalesce(m->'media', '[]'::jsonb), coalesce(m->>'status', ''), m->>'error', at)
  on conflict (id) do update set
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
  where c.id = conv;

  return inserted;
end;
$$;

revoke execute on function public.record_message(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_message(jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Freya's WhatsApp lead log (replaces the "Freya - WhatsApp Leads" Google Sheet).
-- Written by the n8n workflow after every message; shown on the dashboard's Leads page.
create table if not exists public.wa_leads (
  phone          text primary key,                -- "+971542968754" (no "whatsapp:" prefix)
  name           text not null default '',
  wa_name        text not null default '',
  query          text not null default '',
  association    text not null default '',        -- comma separated codes
  interest       text not null default '',        -- comma separated codes
  business_owner text not null default 'unknown',  -- yes | no | unknown
  stage          text not null default 'new',      -- new | engaged | qualified | booking_link_sent | member | handoff | opted_out
  handoff        boolean not null default false,
  notes          text not null default '',
  last_seen      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists wa_leads_last_seen_idx on public.wa_leads (last_seen desc nulls last);

create or replace function public.wa_leads_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists wa_leads_touch on public.wa_leads;
create trigger wa_leads_touch before update on public.wa_leads for each row execute function public.wa_leads_touch();

alter table public.wa_leads enable row level security;

-- ---------------------------------------------------------------------------
-- Team inbox: who handles each chat, agent availability, and internal notes.
alter table public.conversations
  add column if not exists assignee text references public.app_users (username) on update cascade on delete set null,
  add column if not exists assigned_at timestamptz;
create index if not exists conversations_assignee_idx on public.conversations (assignee) where assignee is not null;

alter table public.app_users
  add column if not exists wa_available boolean not null default true;

create table if not exists public.conversation_notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.conversations (id) on delete cascade,
  author          text not null,                    -- app_users.username, or 'system'
  author_name     text not null default '',
  body            text not null,
  mentions        text[] not null default '{}',
  kind            text not null default 'note' check (kind in ('note', 'event')),
  created_at      timestamptz not null default now()
);
create index if not exists conversation_notes_conv_idx on public.conversation_notes (conversation_id, created_at);
alter table public.conversation_notes enable row level security;
