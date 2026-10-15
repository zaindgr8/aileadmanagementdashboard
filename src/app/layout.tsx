import type { Metadata, Viewport } from 'next';
import { Inter, Lexend } from 'next/font/google';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const lexend = Lexend({ variable: '--font-lexend', subsets: ['latin'], weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: { default: 'AI Lead Management', template: '%s · AI Lead Management' },
  description: 'AI Lead Management by DevMate Solutions: WhatsApp AI agent, voice-call campaigns and one lead pipeline.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

// Set the theme before first paint so there's no light/dark flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${inter.variable} ${lexend.variable} antialiased`}>{children}</body>
    </html>
  );
}
