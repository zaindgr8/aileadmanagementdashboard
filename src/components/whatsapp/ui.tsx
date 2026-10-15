"use client";
import { ChessKnight } from "lucide-react";
import { STAGE_META, initials, scoreTone } from "@/lib/whatsapp/client";
import type { LeadStage } from "@/lib/whatsapp/types";

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-xl text-white shadow-[0_6px_20px_-6px_var(--brand)]"
      style={{ width: size, height: size, background: "linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%)" }}>
      <ChessKnight size={size * 0.52} strokeWidth={2.2} />
    </span>
  );
}

export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(135deg, hsl(${h} 32% 50%), hsl(${(h + 40) % 360} 32% 38%))` }}>
      {initials(name)}
    </span>
  );
}

export function StageChip({ stage, className = "" }: { stage: LeadStage; className?: string }) {
  const m = STAGE_META[stage];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.chip} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
    </span>
  );
}

/** Compact lead score: a ring that fills with the score. */
export function ScoreRing({ score, size = 22 }: { score: number; size?: number }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${scoreTone(score)}`} style={{ width: size, height: size }} title={`Lead score ${score}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={2.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset .4s ease" }} />
      </svg>
      <span className="absolute font-semibold tabular-nums" style={{ fontSize: size * 0.38 }}>{score}</span>
    </span>
  );
}
