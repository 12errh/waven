import type {Metadata} from 'next';
import {Outfit, Plus_Jakarta_Sans, JetBrains_Mono} from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'WAVEN — Spatial Music Player',
  description:
    'Spatial frosted-glass music player to discover, search, upload, and play all your favorite music.',
  openGraph: {
    title: 'WAVEN — Spatial Music Player',
    description:
      'Spatial frosted-glass music player to discover, search, upload, and play all your favorite music.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WAVEN — Spatial Music Player',
    description:
      'Spatial frosted-glass music player to discover, search, upload, and play all your favorite music.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="bg-[#07080b] text-white antialiased selection:bg-white/20 selection:text-white overflow-x-hidden"
      >
        {children}
      </body>
    </html>
  );
}
