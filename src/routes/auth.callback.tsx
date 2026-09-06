import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({ meta: [{ title: "Signing in — BloxStar" }, { name: "robots", content: "noindex" }] }),
  component: LegacyGoogleCallback,
});

function safeReturn(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function LegacyGoogleCallback() {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ret = safeReturn(p.get("return"));
    window.location.replace("/api/public/auth/google/start?return=" + encodeURIComponent(ret));
  }, []);
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif" }}>Finishing sign-in…</main>;
}
