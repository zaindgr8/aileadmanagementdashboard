# Workspaces (one per client)

Every client gets a **workspace**: its own WhatsApp inbox, leads, team, AI agent settings and API keys.
People in one workspace never see another workspace's data.

## Roles

| Who | Can |
|---|---|
| **Platform admin** (you) | Approve or suspend workspaces, onboard clients, open any workspace (sidebar switcher or Admin console → Open). |
| **Owner** | Everything in their own workspace: connections, invites, team, AI agent. |
| **Admin** | Same as owner, except making other admins. |
| **Agent** | Works chats and leads in the modules they were given. |

## Onboarding a client

**A. You invite them**
1. Go to **Admin console → Onboard client**, then enter the company, the owner's email and the modules.
2. Copy the invite link and send it to the owner. The link works once and expires in 7 days.
3. The owner picks a username and password and lands in their workspace.
4. In **Workspace settings → Connections**, the owner or you saves:
   - their Twilio Account SID, auth token and WhatsApp sender, then clicks **Test connection**;
   - their Retell API key, if they use voice calls.
5. In Twilio, set the sender's webhooks to the two URLs shown on that page. The URLs include `?ws=<workspace-id>`.
6. Set the AI agent's persona and knowledge under **WhatsApp → AI agent**.

**B. They sign up**
1. The client signs up at `/signup`, which creates a workspace marked *waiting for approval*.
2. You approve it in the Admin console. They can then sign in and continue from step 4 above.

Set `SIGNUP_ENABLED=false` to turn off public sign-up, so clients can only join by invite.

## What changes per client

- **WhatsApp:** Twilio credentials and sender are saved per workspace, and the auth token is encrypted.
- **Voice:** the Retell API key and allowed agent IDs are saved per workspace.
- **AI:** Gemini is the platform's key, shared by all workspaces. Usage is logged per workspace in `agent_events`.
- **Data:** chats, messages, notes, call leads, campaigns and settings all carry `workspace_id`.

The **primary workspace** (`ai-founder-hub`) is the original install:
- any key it hasn't saved falls back to `.env.local`;
- it alone uses the Freya tables `wa_leads` and `masterclass_leads`, which the n8n flows write.

## Database

Run `supabase/workspaces.sql` once, after `platform.sql` and `whatsapp.sql`. It:
- creates `workspaces` and `invites`;
- adds `workspace_id` everywhere;
- moves existing data into the primary workspace;
- re-keys chats by `(workspace_id, id)`.

Saved keys are encrypted with `CREDENTIALS_KEY`, or with a key derived from `SESSION_SECRET` if that isn't set. Changing that key means re-entering every saved client key.
