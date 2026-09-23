import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { LeagueProvider } from "@/components/league";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Currie Cup Fantasy",
  description: "An invite-only Currie Cup fantasy league on real results.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="shell">
            <div className="brand">Currie Cup <span>Fantasy</span></div>
            <div className="tagline">Eight unions, real results, invite only.</div>
            <Nav />
          </div>
        </header>
        <main className="shell">
          <AuthGate>
            <LeagueProvider>{children}</LeagueProvider>
          </AuthGate>
        </main>
      </body>
    </html>
  );
}
