import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Debate',
  description: 'A multi-model AI debate tool powered by Concentrate AI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-50 text-gray-900 antialiased dark:bg-concentrate-black dark:text-white">
        {children}
      </body>
    </html>
  );
}
