import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { DEFAULT_BRAND_NAME, DEFAULT_BRAND_TAGLINE } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for the cosmos observatory hero only — never used on body
// text or CRM working surfaces (see .claude/skills/mimir-cosmos).
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

// Renders outside the (app) group — no session here, so this is the deployment
// brand, not the tenant's. Per-tenant naming happens inside the shell.
export const metadata: Metadata = {
  title: DEFAULT_BRAND_NAME,
  description: `${DEFAULT_BRAND_NAME} — ${DEFAULT_BRAND_TAGLINE}`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {/* Apply the persisted theme before first paint (no dark-mode flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}',
          }}
        />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
