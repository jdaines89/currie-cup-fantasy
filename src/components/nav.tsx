"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const TABS = [
  ["/", "Home"],
  ["/predict/", "Predict"],
  ["/chat/", "Chat"],
  ["/fixtures/", "Fixtures"],
  ["/standings/", "Log"],
  ["/leaderboard/", "Leaderboard"],
];

interface Unread { count: number; tagged: boolean }

/** Messages from others since this member last opened the chat, and whether any tag them. */
function useUnread(uid: string | null): Unread {
  const [u, setU] = useState<Unread>({ count: 0, tagged: false });
  const refresh = useCallback(async () => {
    if (!uid) return;
    const { data: r } = await supabase.from("chat_reads").select("last_read_id").eq("user_id", uid).maybeSingle();
    const since = r?.last_read_id ?? 0;
    const [msgs, tags] = await Promise.all([
      supabase.from("chat_messages").select("id", { count: "exact", head: true }).gt("id", since).neq("author_id", uid),
      supabase.from("chat_mentions").select("message_id", { count: "exact", head: true }).gt("message_id", since).eq("user_id", uid),
    ]);
    setU({ count: msgs.count ?? 0, tagged: (tags.count ?? 0) > 0 });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    refresh();
    const ch = supabase.channel("chat-badge")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => refresh())
      .subscribe();
    window.addEventListener("chat-read", refresh);
    return () => { supabase.removeChannel(ch); window.removeEventListener("chat-read", refresh); };
  }, [uid, refresh]);
  return u;
}

export function Nav() {
  const path = usePathname();
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  const unread = useUnread(uid);
  if (!uid) return <nav className="tabs" />;
  return (
    <nav className="tabs">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={path === href ? "on" : ""}>
          {label}
          {href === "/chat/" && path !== href && unread.count > 0 &&
            <span className={unread.tagged ? "count at" : "count"}>{unread.tagged ? "@" : unread.count}</span>}
        </Link>
      ))}
      <button className="ghost signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </nav>
  );
}
