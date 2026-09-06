import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/auth/google/start")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in with Google — BloxStar" },
      { name: "description", content: "Redirecting you to Google to finish signing in to BloxStar." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GoogleStartPage,
});

function safeReturn(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function GoogleStartPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ret = safeReturn(new URLSearchParams(window.location.search).get("return"));
    window.location.replace("/api/public/auth/google/start?return=" + encodeURIComponent(ret));
  }, []);
  return <AuthStatus title="Taking you to Google…" message={error} />;
}

export function AuthStatus({ title, message }: { title: string; message?: string | null }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui,sans-serif", background: "#0b1120", color: "#f8fafc", padding: "24px", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{message ? "Sign-in failed" : title}</h1>
        <p style={{ marginTop: "12px", opacity: 0.75 }}>{message ?? "Hang tight, this only takes a second."}</p>
        <p style={{ marginTop: "20px" }}><a href="/" style={{ color: "#60a5fa" }}>Back to BloxStar</a></p>
      </div>
    </main>
  );
}
