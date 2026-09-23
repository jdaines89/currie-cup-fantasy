"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NeedsPool, useLeague } from "@/components/league";
import { encodeMentions, splitMentions, typingTag } from "@/lib/mentions";
import { supabase } from "@/lib/supabase";
import type { ChatMessage, Member } from "@/lib/types";

const PAGE = 200;

export default function ChatPage() {
  return <NeedsPool><Chat /></NeedsPool>;
}

function Chat() {
  const { me, members: everyone, pool } = useLeague();
  const poolId = pool!.id;
  const [inPool, setInPool] = useState<Set<string>>(new Set());
  const members = useMemo(() => everyone.filter((m) => inPool.has(m.user_id)), [everyone, inPool]);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const people = useMemo(() => new Map(everyone.map((m) => [m.user_id, m])), [everyone]);

  useEffect(() => {
    supabase.from("pool_members").select("user_id").eq("pool_id", poolId)
      .then(({ data }) => setInPool(new Set((data ?? []).map((r: { user_id: string }) => r.user_id))));
  }, [poolId]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("chat_messages").select("*").eq("pool_id", poolId).order("id", { ascending: false }).limit(PAGE);
    setMsgs(((data ?? []) as ChatMessage[]).reverse());
  }, [poolId]);

  // Live: new and deleted messages arrive as they happen.
  useEffect(() => {
    load();
    const ch = supabase.channel(`chat:${poolId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `pool_id=eq.${poolId}` },
        (p) => setMsgs((xs) => xs.some((x) => x.id === (p.new as ChatMessage).id) ? xs : [...xs, p.new as ChatMessage]))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" },
        (p) => setMsgs((xs) => xs.filter((x) => x.id !== (p.old as { id: number }).id)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, poolId]);

  // Scroll to the newest and mark it read.
  const lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
    if (lastId) {
      supabase.from("chat_reads").upsert({ user_id: me.user_id, pool_id: poolId, last_read_id: lastId }).then(() =>
        window.dispatchEvent(new Event("chat-read")));
    }
  }, [lastId, me.user_id, poolId]);

  const matches = tag === null ? [] :
    members.filter((m) => m.user_id !== me.user_id && m.display_name.toLowerCase().startsWith(tag.toLowerCase())).slice(0, 5);

  function onType(v: string) {
    setText(v);
    const cur = box.current?.selectionStart ?? v.length;
    setTag(typingTag(v.slice(0, cur)));
    setPick(0);
  }

  function choose(m: Member) {
    const cur = box.current?.selectionStart ?? text.length;
    const before = text.slice(0, cur).replace(/@[^@]*$/, `@${m.display_name} `);
    const next = before + text.slice(cur);
    setText(next); setTag(null);
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(before.length, before.length); });
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = encodeMentions(text.trim(), members);
    if (!body) return;
    setErr(null);
    const { data, error } = await supabase.from("chat_messages").insert({ body, pool_id: poolId }).select().single();
    if (error) { setErr(error.message); return; }
    setText(""); setTag(null);
    setMsgs((xs) => xs.some((x) => x.id === data.id) ? xs : [...xs, data as ChatMessage]);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setPick((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPick((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[pick]); return; }
      if (e.key === "Escape") { setTag(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function remove(id: number) {
    const { error } = await supabase.from("chat_messages").delete().eq("id", id);
    if (!error) setMsgs((xs) => xs.filter((x) => x.id !== id));
  }

  return (
    <div className="card chat">
      <h2>{pool!.name} chat</h2>
      <p className="sub">Only people in this pool see it. Type @ to tag someone.</p>
      <div className="chatlog">
        {msgs.length === 0 && <p className="muted small">No messages yet. Start the banter.</p>}
        {msgs.map((m, i) => {
          const who = people.get(m.author_id);
          const mine = m.author_id === me.user_id;
          const parts = splitMentions(m.body);
          const tagsMe = parts.some((p) => "userId" in p && p.userId === me.user_id);
          const grouped = i > 0 && msgs[i - 1].author_id === m.author_id
            && new Date(m.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() < 5 * 60_000;
          return (
            <div key={m.id} className={`msg${mine ? " mine" : ""}${tagsMe ? " tagged" : ""}${grouped ? " grouped" : ""}`}>
              {!grouped && (
                <div className="meta">
                  <strong>{mine ? "You" : who?.display_name ?? "Former member"}</strong>
                  <span>{when(m.created_at)}</span>
                </div>
              )}
              <div className="bubble">
                {parts.map((p, j) => "text" in p ? <span key={j}>{p.text}</span>
                  : <span key={j} className={`tag${p.userId === me.user_id ? " me" : ""}`}>@{people.get(p.userId)?.display_name ?? "someone"}</span>)}
                {mine && <button type="button" className="del" aria-label="Delete message" onClick={() => remove(m.id)}>×</button>}
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={send}>
        {matches.length > 0 && (
          <ul className="tagpick" role="listbox">
            {matches.map((m, i) => (
              <li key={m.user_id} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); choose(m); }}>@{m.display_name}</li>
            ))}
          </ul>
        )}
        <textarea ref={box} rows={1} maxLength={900} placeholder="Message the league" value={text}
          onChange={(e) => onType(e.target.value)} onKeyDown={onKey} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
      {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
    </div>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(today ? {} : { weekday: "short", day: "numeric", month: "short" }),
  });
}
