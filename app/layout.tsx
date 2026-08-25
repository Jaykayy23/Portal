import type { Metadata } from 'next';
import { ToastProvider } from '@/components/Toast';
import './globals.css';
import localFont from 'next/font/local';
import { cn } from '@/lib/utils';

// Roboto is the only typeface the portal uses; the stylesheet's display, body
// and mono type tokens all resolve to it.
//
// Vendored into app/fonts rather than pulled with next/font/google. The
// build-time download that next/font/google performs cannot reach
// fonts.gstatic.com from this network, which fails the build outright — and it
// would fail the same way inside the Docker image. Vendoring the latin weight
// axis keeps the build hermetic and offline-safe.
//
// The file is the SIL OFL latin subset of Roboto Flex's weight axis, taken from
// @fontsource-variable/roboto. Roboto is the system face on Android, which is
// what most merchants file requests from, so on a phone the portal is very
// often rendering a face the device already has cached.
const roboto = localFont({
  src: './fonts/Roboto-Variable.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-sans',
  fallback: ['Roboto', 'system-ui', 'sans-serif'],
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
      className={cn('font-sans', roboto.variable)}
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
