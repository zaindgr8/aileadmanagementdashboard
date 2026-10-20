import {
  BarChart3, Bot, History, Kanban, LayoutDashboard, LayoutGrid, ListChecks, Megaphone, MessageCircle, PhoneCall,
  PhoneOutgoing, Rocket, Settings2, ShieldCheck, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, SessionUser } from '@/lib/auth/modules';

export interface NavItem { href: string; label: string; icon: LucideIcon; hint?: string }
export interface NavSection { module?: ModuleKey; title?: string; icon?: LucideIcon; items: NavItem[] }

export const NAV: NavSection[] = [
  { items: [{ href: '/', label: 'Home', icon: LayoutDashboard, hint: 'Both channels at a glance' }] },
  {
    module: 'whatsapp', title: 'WhatsApp', icon: MessageCircle,
    items: [
      { href: '/whatsapp', label: 'Inbox', icon: MessageCircle, hint: 'Live WhatsApp chats' },
      { href: '/whatsapp/leads', label: 'Leads', icon: Users, hint: 'Lead profiles from your WhatsApp agent' },
      { href: '/whatsapp/pipeline', label: 'Pipeline', icon: Kanban, hint: 'Drag chats between stages' },
      { href: '/whatsapp/history', label: 'History', icon: History, hint: 'Search every message' },
      { href: '/whatsapp/team', label: 'Team', icon: UserCog, hint: 'Teammates, assignment and AI scoring' },
      { href: '/whatsapp/agent', label: 'AI agent', icon: Bot, hint: 'Who replies, persona and handoff' },
      { href: '/whatsapp/analytics', label: 'Analytics', icon: BarChart3, hint: 'Funnel and response times' },
    ],
  },
  {
    module: 'calls', title: 'Voice calls', icon: PhoneCall,
    items: [
      { href: '/calls', label: 'Overview', icon: LayoutGrid, hint: 'How your voice agents are performing' },
      { href: '/calls/leads', label: 'Leads', icon: Users, hint: 'Who to call and what to do next' },
      { href: '/calls/new', label: 'New call', icon: PhoneOutgoing, hint: 'An AI agent calls one person now' },
      { href: '/calls/bulk', label: 'Bulk campaign', icon: Megaphone, hint: 'Upload a list and call everyone' },
      { href: '/calls/campaigns', label: 'Campaigns', icon: ListChecks, hint: 'Progress of bulk campaigns' },
      { href: '/calls/history', label: 'Call history', icon: History, hint: 'Recordings, transcripts and outcomes' },
    ],
  },
];

const ROOTS = new Set(['/', '/whatsapp', '/calls']);
export const isActive = (href: string, path: string) => (ROOTS.has(href) ? path === href : path === href || path.startsWith(`${href}/`));

/** The nav sections this user can see: their modules, plus workspace settings and the admin console when they may use them. */
export function navFor(user: SessionUser): NavSection[] {
  const sections = NAV.filter((s) => !s.module || user.modules.includes(s.module));
  const manage: NavItem[] = [];
  if (user.role === 'owner' || user.role === 'admin' || user.platformAdmin) {
    manage.push({ href: '/setup', label: 'Get started', icon: Rocket, hint: 'Connect your channels and set up your AI agent' });
    manage.push({ href: '/settings', label: 'Workspace settings', icon: Settings2, hint: 'Connections, people and invites' });
  }
  if (user.platformAdmin) manage.push({ href: '/admin', label: 'Admin console', icon: ShieldCheck, hint: 'All client workspaces' });
  return manage.length ? [...sections, { title: 'Workspace', icon: Settings2, items: manage }] : sections;
}
