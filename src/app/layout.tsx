import type { Metadata } from "next";
import "./globals.css";
import { AuthGate } from "@/components/auth-gate";
import { LeagueProvider } from "@/components/league";
import { Nav } from "@/components/nav";
import { Brand } from "@/components/logo";

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
            <Brand />
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
