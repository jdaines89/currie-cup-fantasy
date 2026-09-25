"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Member } from "@/lib/types";

// Pictures live in a private bucket, so each one is shown through a signed
// link. A new picture gets a new file name, so a link per path is safe to
// keep for as long as it lasts.
const LINK_SECONDS = 7 * 24 * 3600;
const links = new Map<string, Promise<string | null>>();

function linkFor(path: string): Promise<string | null> {
  let p = links.get(path);
  if (!p) {
    p = supabase.storage.from("avatars").createSignedUrl(path, LINK_SECONDS)
      .then(({ data }) => data?.signedUrl ?? null, () => null);
    links.set(path, p);
  }
  return p;
}

export function initials(name?: string): string {
  return (name ?? "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** A member's picture, or their initials until they add one. */
export function Avatar({ member, size = 32 }: { member?: Member; size?: number }) {
  const path = member?.avatar_path ?? null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (path) linkFor(path).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [path]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return src
    ? <img className="avatar" src={src} alt="" style={style} onError={() => setSrc(null)} />
    : <span className="avatar" aria-hidden style={style}>{initials(member?.display_name)}</span>;
}
