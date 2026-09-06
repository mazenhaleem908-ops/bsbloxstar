import { CATALOG } from "@/lib/catalog";

export const SITE = "https://www.bloxistar.com";

const CATEGORY = {
  mm2: {
    path: "/mm2",
    name: "MM2",
    title: "Cheap MM2 Items & Godlys | BloxStar",
    description: "Buy cheap MM2 items, godlys, chromas, knives and sets at BloxStar, an online MM2 shop and Roblox marketplace.",
    intro: "BloxStar is an MM2 shop focused on affordable Murder Mystery 2 items, including godlys, chromas, knives, guns and sets.",
  },
  adoptme: {
    path: "/adopt-me",
    name: "Adopt Me",
    title: "Adopt Me Pets & Items | BloxStar Roblox Marketplace",
    description: "Browse Adopt Me pets and Roblox items available through BloxStar's Roblox marketplace.",
    intro: "Browse the BloxStar Adopt Me selection and discover Roblox pets and items available in the marketplace.",
  },
  gag: {
    path: "/grow-a-garden",
    name: "Grow a Garden",
    title: "Grow a Garden Items | BloxStar Roblox Marketplace",
    description: "Browse Grow a Garden items on BloxStar's Roblox marketplace, with a clean catalog and clear item information.",
    intro: "Explore BloxStar's Grow a Garden catalog and browse available Roblox items by game.",
  },
  roblox: {
    path: "/roblox-items",
    name: "Roblox",
    title: "Roblox Items & Marketplace | BloxStar",
    description: "Browse Roblox items across supported games on BloxStar, a Roblox marketplace with clear item information and checkout.",
    intro: "Explore Roblox items from supported games on BloxStar, including MM2, Adopt Me and Grow a Garden.",
  },
} as const;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function categoryHtml(key: keyof typeof CATEGORY): string {
  const c = CATEGORY[key];
  const gameKey = key === "adoptme" ? "adoptme" : key === "gag" ? "gag" : "mm2";
  const items = key === "roblox" ? CATALOG.filter((item) => item.a).slice(0, 80) : CATALOG.filter((item) => item.g === gameKey && item.a).slice(0, 60);
  const itemList = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.n,
  }));
  const graph = [
    { "@type": "Organization", "@id": `${SITE}/#organization`, name: "BloxStar", url: `${SITE}/`, alternateName: ["Blox Star", "Bloxistar"] },
    { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "BloxStar", alternateName: ["Blox Star", "Bloxistar"], publisher: { "@id": `${SITE}/#organization` } },
    { "@type": "WebPage", "@id": `${SITE}${c.path}#webpage`, url: `${SITE}${c.path}`, name: c.title, description: c.description, isPartOf: { "@id": `${SITE}/#website` }, breadcrumb: { "@id": `${SITE}${c.path}#breadcrumb` } },
    { "@type": "BreadcrumbList", "@id": `${SITE}${c.path}#breadcrumb`, itemListElement: [
      { "@type": "ListItem", position: 1, name: "BloxStar", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: c.name, item: `${SITE}${c.path}` },
    ] },
    { "@type": "ItemList", "@id": `${SITE}${c.path}#items`, name: `${c.name} items`, itemListElement: itemList },
  ];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.title)}</title><meta name="description" content="${esc(c.description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${SITE}${c.path}">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website"><meta property="og:site_name" content="BloxStar"><meta property="og:url" content="${SITE}${c.path}"><meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(c.title)}"><meta name="twitter:description" content="${esc(c.description)}">
<script src="https://analytics.ahrefs.com/analytics.js" data-key="+LUeJMWE+klvsGU+pVgxFw" async></script>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>
<style>body{margin:0;font-family:Arial,sans-serif;background:#f4fbff;color:#221f2e}.wrap{max-width:1100px;margin:auto;padding:40px 20px}a{color:#0d7fd6}.crumb{font-size:14px;margin-bottom:24px}.card{background:#fff;border:1px solid #d8ecfb;border-radius:16px;padding:18px;margin:10px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.price{font-weight:700}.muted{color:#736c8a}h1{font-size:36px;margin:0 0 12px}h2{margin-top:36px}</style></head><body><main class="wrap">
<nav class="crumb"><a href="/">BloxStar</a> / ${esc(c.name)} · <a href="/mm2">MM2</a> · <a href="/adopt-me">Adopt Me</a> · <a href="/grow-a-garden">Grow a Garden</a> · <a href="/roblox-items">Roblox Items</a></nav><h1>${esc(c.name)} items</h1><p>${esc(c.intro)}</p><p class="muted">Browse the catalog below, then use the main BloxStar storefront for checkout and delivery.</p><div class="grid">
${items.map((item) => `<article class="card" id="item-${item.id}"><h2 style="font-size:18px;margin:0 0 8px">${esc(item.n)}</h2><div class="price">$${Number(item.p).toFixed(2)}</div><p class="muted">${esc(c.name)} item available on BloxStar.</p><a href="/">Open BloxStar shop</a></article>`).join("")}
</div><h2>Shop BloxStar</h2><p><a href="/">Return to BloxStar</a> to browse the full Roblox marketplace, sign in, and use the existing checkout flow.</p></main></body></html>`;
}
