import { createFileRoute } from "@tanstack/react-router";
import { categoryHtml } from "./seo-pages";
export const Route = createFileRoute("/mm2")({ server: { handlers: { GET: async () => new Response(categoryHtml("mm2"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" } }) } } });
