import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vidpod – Podcast Ad Manager',
  description: 'Manage dynamic ads for your podcast episodes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
