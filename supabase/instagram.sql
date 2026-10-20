-- Instagram channel. Run after workspaces.sql. Safe to re-run.
-- Instagram chats live in the same tables as WhatsApp: conversation id "instagram:<Instagram-scoped user id>".
alter table public.conversations add column if not exists channel text not null default 'whatsapp' check (channel in ('whatsapp', 'instagram'));
create index if not exists conversations_ws_channel_idx on public.conversations (workspace_id, channel);
-- record_message (workspaces.sql) is replaced so new chats get their channel and no fake phone number:
-- see the migration "conversations_channel_instagram" (same body as workspaces.sql, plus `channel`).
