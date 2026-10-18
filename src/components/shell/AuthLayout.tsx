import { ThemeToggle } from '@/components/shell/theme';
import { SixtyLogo } from '@/components/shell/SixtyLogo';

// The first minute of a lead, as told on sixty.devmatesolutions.com.
const TIMELINE = [
  ['00:03', 'First reply', 'Warm and natural, in English, Arabic or 40+ languages.'],
  ['00:20', 'Qualified', 'Budget, dates, needs: asked and answered.'],
  ['00:50', 'Booked', 'Viewing, table or consultation in your calendar.'],
  ['01:00', 'Your rep takes over', 'Hot leads reach the right person with a one-line brief.'],
] as const;

/** The two-panel layout shared by sign-in, sign-up and invite pages. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#0a0a0b] p-12 text-[#f2f2f2] lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full opacity-35 blur-3xl" style={{ background: 'radial-gradient(circle, #bd2120 0%, transparent 70%)' }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'linear-gradient(to top, black, transparent 75%)' }} />

        <SixtyLogo size={34} className="relative text-white" />

        <div className="relative mt-auto max-w-lg">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1 font-mono text-[11px] text-white/70">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3ee0a6] shadow-[0_0_8px_#3ee0a6]" />AI sales agent for WhatsApp &amp; phone
          </span>
          <h2 className="mt-5 font-display text-[40px] font-semibold leading-[1.06] tracking-tight">
            Every lead answered in <span className="whitespace-nowrap text-[#ff8a8c]">60 seconds.</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">
            Sixty replies like your best rep, day or night. It qualifies the lead, books the next step and updates your pipeline before your competitor even sees the message.
          </p>

          <ol className="mt-8 space-y-3.5">
            {TIMELINE.map(([t, title, desc]) => (
              <li key={t} className="flex gap-4">
                <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-[#e5484d]">{t}</span>
                <span className="text-sm leading-snug"><span className="font-medium text-white">{title}</span> <span className="text-white/55">{desc}</span></span>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mt-12 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/40">
          <span>sixty.devmatesolutions.com</span>
          <span>Official WhatsApp Business API</span>
          <span>Dubai · NYC · Muscat</span>
        </div>
      </aside>

      <main className="relative grid place-items-center px-4 py-10">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="anim-rise w-full max-w-sm">
          <SixtyLogo size={34} className="mb-9" />
          {children}
          <p className="mt-8 text-center text-[11px] text-ink-3">Sixty by DevMate Solutions · Every lead in 60 seconds</p>
        </div>
      </main>
    </div>
  );
}
