import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Currie Cup Fantasy",
  description: "Fantasy rugby for the Currie Cup, running on free live data.",
};

const TABS = [
  ["/", "Dashboard"],
  ["/pool", "Union Pool"],
  ["/squad", "Squad"],
  ["/fixtures", "Fixtures"],
  ["/standings", "Log"],
  ["/leaderboard", "Leaderboard"],
  ["/admin", "Admin"],
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="shell">
            <div className="brand">Currie Cup <span>Fantasy</span></div>
            <div className="tagline">Eight unions, real results, no subscription.</div>
            <nav className="tabs">
              {TABS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
