'use client';

import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/voice/calls';
import type { DashboardConfig, LeanCall } from '@/lib/voice/types';

export interface HistoryFilters { q: string; agent: string; outcome: string; sentiment: string; success: string; page: number }
export interface CallPrefill { to?: string; agent_id?: string; from?: string; vars?: Record<string, string> }
/** Contacts handed to the bulk campaign page, in the same shape as a parsed CSV. */
export interface CampaignPrefill { label: string; headers: string[]; rows: string[][] }
interface Toast { id: number; msg: string; err: boolean }

interface Ctx {
  config: DashboardConfig | null;
  configError: string;
  reloadConfig: () => Promise<void>;
  days: number;
  setDays: (d: number) => void;
  calls: LeanCall[];
  prevCalls: LeanCall[];
  loaded: boolean;
  /** When the current call data was fetched (ms). 0 until the first load. */
  loadedAt: number;
  loading: boolean;
  reloadCalls: (opts?: { silent?: boolean }) => Promise<void>;
  history: HistoryFilters;
  setHistory: (u: Partial<HistoryFilters>) => void;
  callPrefill: CallPrefill | null;
  setCallPrefill: (p: CallPrefill | null) => void;
  campaignPrefill: CampaignPrefill | null;
  setCampaignPrefill: (p: CampaignPrefill | null) => void;
  openCallId: string | null;
  openCall: (id: string | null) => void;
  /** Phone of the lead shown in the lead drawer. */
  openLeadPhone: string | null;
  openLead: (phone: string | null) => void;
  /** Bumped whenever a lead changes, so lists can refetch. */
  leadsVersion: number;
  bumpLeads: () => void;
  toast: (msg: string, err?: boolean) => void;
  toasts: Toast[];
}

const DashboardContext = createContext<Ctx | null>(null);

export function useDashboard() {
  const ctx = use(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside DashboardProvider');
  return ctx;
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [days, setDaysState] = useState(30);
  const [calls, setCalls] = useState<LeanCall[]>([]);
  const [prevCalls, setPrevCalls] = useState<LeanCall[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [history, setHistoryState] = useState<HistoryFilters>({ q: '', agent: '', outcome: '', sentiment: '', success: '', page: 0 });
  const [callPrefill, setCallPrefill] = useState<CallPrefill | null>(null);
  const [campaignPrefill, setCampaignPrefill] = useState<CampaignPrefill | null>(null);
  const [openCallId, openCall] = useState<string | null>(null);
  const [openLeadPhone, openLead] = useState<string | null>(null);
  const [leadsVersion, setLeadsVersion] = useState(0);
  const bumpLeads = useCallback(() => setLeadsVersion((v) => v + 1), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const daysRef = useRef(days);

  const toast = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const reloadConfig = useCallback(async () => {
    try {
      setConfig(await api<DashboardConfig>('/api/voice/config'));
      setConfigError('');
    } catch (e) {
      setConfigError((e as Error).message);
    }
  }, []);

  const reloadCalls = useCallback(async ({ silent = false } = {}) => {
    setLoading(true);
    try {
      const d = daysRef.current;
      const end = Date.now();
      const span = d * 86400_000;
      // Fetch two periods at once so KPIs can compare against the previous one.
      const { calls: all } = await api<{ calls: LeanCall[] }>(`/api/voice/calls?start=${end - 2 * span}&end=${end}`);
      if (d !== daysRef.current) return; // range changed mid-flight
      setCalls(all.filter((c) => (c.start ?? end) >= end - span));
      setPrevCalls(all.filter((c) => c.start && c.start < end - span));
      setLoaded(true);
      setLoadedAt(end);
    } catch (e) {
      if (!silent) toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const setDays = useCallback((d: number) => {
    daysRef.current = d;
    setDaysState(d);
    setLoaded(false);
    reloadCalls();
  }, [reloadCalls]);

  const setHistory = useCallback((u: Partial<HistoryFilters>) => setHistoryState((h) => ({ ...h, ...u })), []);

  useEffect(() => {
    // Initial load; the async functions only set state after their fetches resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadConfig();
    reloadCalls();
  }, [reloadConfig, reloadCalls]);

  // Quiet auto-refresh so live calls and fresh results show up.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || openCallId || openLeadPhone) return;
      if (document.activeElement?.matches('input, select, textarea')) return;
      reloadConfig();
      reloadCalls({ silent: true });
    }, 30000);
    return () => clearInterval(t);
  }, [openCallId, openLeadPhone, reloadCalls, reloadConfig]);

  const value = useMemo<Ctx>(() => ({
    config, configError, reloadConfig, days, setDays, calls, prevCalls, loaded, loadedAt, loading, reloadCalls,
    history, setHistory, callPrefill, setCallPrefill, campaignPrefill, setCampaignPrefill, openCallId, openCall, openLeadPhone, openLead, leadsVersion, bumpLeads, toast, toasts,
  }), [config, configError, reloadConfig, days, setDays, calls, prevCalls, loaded, loadedAt, loading, reloadCalls, history, setHistory, callPrefill, campaignPrefill, openCallId, openLeadPhone, leadsVersion, bumpLeads, toast, toasts]);

  return <DashboardContext value={value}>{children}</DashboardContext>;
}

// ---------- Tooltip ----------

interface TipState { content: ReactNode; x: number; y: number; path: string }
const TipContext = createContext<(content: ReactNode | null, e?: React.MouseEvent) => void>(() => {});

export function TooltipProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [rawTip, setTip] = useState<TipState | null>(null);
  // A tooltip belongs to the page it was opened on; navigating away hides it.
  const tip = rawTip?.path === pathname ? rawTip : null;
  const ref = useRef<HTMLDivElement>(null);
  const show = useCallback((content: ReactNode | null, e?: React.MouseEvent) => {
    setTip(content && e ? { content, x: e.clientX, y: e.clientY, path: window.location.pathname } : null);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    el.style.left = `${Math.min(tip.x + 14, window.innerWidth - el.offsetWidth - 8)}px`;
    el.style.top = `${Math.max(8, tip.y - el.offsetHeight - 12)}px`;
  }, [tip]);
  return (
    <TipContext value={show}>
      {children}
      <div ref={ref} className={`tooltip${tip ? ' show' : ''}`} role="tooltip">{tip?.content}</div>
    </TipContext>
  );
}

/** Spread onto any element to give it a hover tooltip. */
export function useTip() {
  const show = use(TipContext);
  return useCallback((content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => show(content, e),
    onMouseLeave: () => show(null),
  }), [show]);
}
