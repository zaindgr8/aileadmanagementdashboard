// Sixty brand mark: a 60-second ring, as on sixty.devmatesolutions.com.

/** The ring on its own, in the current text colour unless `tile` is set. */
export function SixtyMark({ size = 32, tile = false, className = '' }: { size?: number; tile?: boolean; className?: string }) {
  if (tile) {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0A0A0B" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="#E5484D" strokeWidth="2" opacity=".3" />
        <path d="M16 6a10 10 0 1 1-8.7 5" fill="none" stroke="#E5484D" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2.4" fill="#F2F2F2" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" opacity=".25" />
      <path d="M16 3a13 13 0 1 1-11.3 6.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}

/** Mark + "SIXTY" wordmark, with an optional "by DevMate" line. */
export function SixtyLogo({ size = 30, by = true, className = '' }: { size?: number; by?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <SixtyMark size={size} className="text-[#E5484D]" />
      <span className="leading-none">
        <span className="block font-display text-[15px] font-bold uppercase tracking-[.16em]">Sixty</span>
        {by && <span className="mt-1 block text-[10.5px] font-medium tracking-wide opacity-60">by DevMate</span>}
      </span>
    </span>
  );
}
