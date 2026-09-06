import { createFileRoute } from "@tanstack/react-router";
import { categoryHtml } from "./seo-pages";
export const Route = createFileRoute("/roblox-items")({ server: { handlers: { GET: async () => new Response(categoryHtml("roblox"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" } }) } } });
