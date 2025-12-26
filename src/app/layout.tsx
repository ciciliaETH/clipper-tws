import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clipper - Trade With Suli",
  description: "Clipper Analytics Dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable} antialiased min-h-screen bg-aurora`}
      >
        {/* Gradient top glow */}
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-40 bg-gradient-to-b from-blue-600/30 to-transparent blur-2xl"></div>
        {/* Parallax aurora layers */}
        <div aria-hidden className="aurora-layer aurora-blue parallax-slow -top-24 -left-10 h-72 w-72" />
        <div aria-hidden className="aurora-layer aurora-sky parallax-med top-20 right-10 h-64 w-64" />
        <div aria-hidden className="aurora-layer aurora-indigo parallax-fast bottom-0 left-1/3 h-80 w-80" />
        {/* Content */}
        <div className="relative min-h-screen">
          {children}
        </div>
      </body>
    </html>
  );
}
