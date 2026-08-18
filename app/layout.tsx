import type { Metadata } from 'next';
import { ToastProvider } from '@/components/Toast';
import './globals.css';
import localFont from 'next/font/local';
import { cn } from '@/lib/utils';

// The three faces the stylesheet's type tokens are built around: Inter (body),
// Space Grotesk (display), IBM Plex Mono (numerics and labels).
//
// These are the Google Fonts originals, but vendored into app/fonts rather than
// pulled with next/font/google. The build-time download that next/font/google
// performs cannot reach fonts.gstatic.com from this network, which fails the
// build outright — and it would fail the same way inside the Docker image.
// Vendoring the latin woff2 subsets keeps the build hermetic and offline-safe.
const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', 'sans-serif'],
});

const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-Variable.woff2',
  weight: '300 700',
  display: 'swap',
  variable: '--font-grotesk',
  fallback: ['system-ui', 'sans-serif'],
});

const plexMono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/IBMPlexMono-600.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-mono',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  title: 'SomoExpress — Merchant Delivery Portal',
  description:
    'Merchant delivery request and pricing tool: distance-based quotes, rider assignment, and one-tap WhatsApp/SMS alerts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        'font-sans',
        inter.variable,
        spaceGrotesk.variable,
        plexMono.variable
      )}
    >
      <body>
        {/* #somo-root carries the design tokens the whole stylesheet reads. */}
        <div id="somo-root">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </body>
    </html>
  );
}
