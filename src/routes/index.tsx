import { createFileRoute } from "@tanstack/react-router";
// The BloxStar storefront is a complete self-contained HTML application
// (public/storefront.html). It is inlined at build time and served verbatim at
// "/" so every page container, script, style and product stays exactly as
// authored. Inlining (instead of a runtime fetch of /storefront.html) keeps it
// working on the edge runtime, where a handler cannot reliably sub-request its
// own origin.
import storefrontHtml from "../../public/storefront.html?raw";

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () =>
        new Response(storefrontHtml, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=0, must-revalidate",
          },
        }),
    },
  },
});
