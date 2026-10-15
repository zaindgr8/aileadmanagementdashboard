import {
  BarChart3, Bot, History, Kanban, LayoutDashboard, LayoutGrid, ListChecks, Megaphone, MessageCircle, PhoneCall,
  PhoneOutgoing, Users, type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/auth/modules';

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

/** The nav sections a user with these modules can see. */
export const navFor = (modules: ModuleKey[]) => NAV.filter((s) => !s.module || modules.includes(s.module));
