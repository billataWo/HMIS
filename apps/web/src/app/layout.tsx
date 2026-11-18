import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Noto_Sans_Ethiopic } from "next/font/google";
import { MotionProvider } from "@/components/motion";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

// Amharic names, labels and month names render in a font designed for Ge'ez script.
const ethiopic = Noto_Sans_Ethiopic({ variable: "--font-ethiopic", subsets: ["ethiopic"], display: "swap" });

const mono = Geist_Mono({ variable: "--font-mono-face", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "HMIS", template: "%s · HMIS" },
  description: "Clinic management: patients, queue, EMR, lab, pharmacy and billing",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

/**
 * Applies the Day / Dark choice (components/theme-switch.tsx) before the first paint, so the page
 * never flashes the other theme. Without a choice, the CSS follows the device's setting.
 */
const THEME_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )hmis_theme=(light|dark)/);if(m)document.documentElement.dataset.theme=m[1]}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions add attributes to <html> before React loads; ignore those (this level only).
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${ethiopic.variable} ${mono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
