'use client';

import type { DashboardConfig, LeanCall } from '@/lib/voice/types';

/** Variable names this agent has been called with before, most common first. */
export function suggestedVars(calls: LeanCall[], agentId?: string) {
  const counts: Record<string, number> = {};
  calls.filter((c) => !agentId || c.agent_id === agentId)
    .forEach((c) => Object.keys(c.vars || {}).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 8);
}

export function avgCostPerDial(calls: LeanCall[], agentId: string) {
  const list = calls.filter((c) => c.agent_id === agentId && c.status !== 'ongoing');
  return list.length ? list.reduce((s, c) => s + c.cost_cents, 0) / list.length : null;
}

/** The agent a number dials with by default, if it's one this dashboard may use. */
export function defaultAgentFor(config: DashboardConfig, phone: string) {
  const p = config.phoneNumbers.find((x) => x.phone_number === phone);
  return config.agents.find((a) => a.agent_id === p?.outbound_agent_id)?.agent_id;
}

export function AgentSelect({ config, phone, value, onChange, name = 'agent' }: {
  config: DashboardConfig; phone: string; value: string; onChange: (v: string) => void; name?: string;
}) {
  const def = defaultAgentFor(config, phone);
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {config.agents.map((a) => (
        <option key={a.agent_id} value={a.agent_id}>{a.agent_name}{a.agent_id === def ? ' (number default)' : ''}</option>
      ))}
    </select>
  );
}

export function PhoneSelect({ config, value, onChange, name = 'from' }: {
  config: DashboardConfig; value: string; onChange: (v: string) => void; name?: string;
}) {
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      {config.phoneNumbers.map((p) => (
        <option key={p.phone_number} value={p.phone_number}>{p.nickname ? `${p.nickname} · ${p.pretty}` : p.pretty}</option>
      ))}
    </select>
  );
}
