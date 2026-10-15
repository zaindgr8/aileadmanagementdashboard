'use client';
import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type Theme = 'light' | 'dark';

/** The current theme (set before paint by the script in the root layout) and a toggle. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    // Read what the pre-paint script chose; it can't be known during server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
    setTheme(next);
  }, []);
  return { theme, toggle };
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme"
      className={`grid h-9 w-9 place-items-center rounded-xl border border-line bg-panel text-ink-2 transition hover:bg-panel-2 hover:text-ink ${className}`}>
      {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
