import type { Metadata } from 'next';
import { Analytics } from "@vercel/analytics/next"
import { ToastProvider } from '@/components/Toast';
import './globals.css';
import localFont from 'next/font/local';
import { cn } from '@/lib/utils';

// Inter is the only typeface the portal uses; the stylesheet's display, body
// and mono type tokens all resolve to it.
//
// This is the Google Fonts original, but vendored into app/fonts rather than
// pulled with next/font/google. The build-time download that next/font/google
// performs cannot reach fonts.gstatic.com from this network, which fails the
// build outright — and it would fail the same way inside the Docker image.
// Vendoring the latin woff2 subset keeps the build hermetic and offline-safe.
const inter = localFont({
  src: './fonts/Inter-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', 'sans-serif'],
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
      className={cn('font-sans', inter.variable)}
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
