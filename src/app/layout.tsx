import type { Metadata, Viewport } from 'next';
import { Inter, Lexend } from 'next/font/google';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] });
const lexend = Lexend({ variable: '--font-lexend', subsets: ['latin'], weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: { default: 'Sixty by DevMate', template: '%s · Sixty' },
  description: 'Sixty by DevMate: AI WhatsApp and voice agents that answer every lead in 60 seconds, with one shared inbox and lead pipeline.',
  // Icons come from app/icon.svg and app/apple-icon.png (the Sixty ring, as on sixty.devmatesolutions.com).
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
