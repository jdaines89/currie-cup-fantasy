"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const TABS = [
  ["/", "Home"],
  ["/predict/", "Predict"],
  ["/fixtures/", "Fixtures"],
  ["/standings/", "Log"],
  ["/leaderboard/", "Leaderboard"],
];

export function Nav() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(Boolean(s)));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!signedIn) return <nav className="tabs" />;
  return (
    <nav className="tabs">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={path === href ? "on" : ""}>{label}</Link>
      ))}
      <button className="ghost signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </nav>
  );
}
