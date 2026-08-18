import type { Metadata } from 'next';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'SomoExpress — Merchant Delivery Portal',
  description:
    'Merchant delivery request and pricing tool: distance-based quotes, rider assignment, and one-tap WhatsApp/SMS alerts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* #somo-root carries the design tokens the whole stylesheet reads. */}
        <div id="somo-root">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </body>
    </html>
  );
}
