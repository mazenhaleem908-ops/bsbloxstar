// The Vercel/Nitro preset writes to .vercel/output. Some CI dist-checks expect a
// conventional dist/ folder, so mirror the built output there after every build.
import { cp, mkdir, rm, copyFile, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const staticDir = path.join(root, ".vercel/output/static");
const serverDir = path.join(root, ".vercel/output/functions/__server.func");
const dist = path.join(root, "dist");

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "client"), { recursive: true });

if (await exists(staticDir)) {
  await cp(staticDir, path.join(dist, "client"), { recursive: true });
}
if (await exists(serverDir)) {
  await cp(serverDir, path.join(dist, "server"), { recursive: true });
}

// The app is server-rendered, so no index.html is emitted. Provide the
// storefront document as index.html so static dist checks find an entry point.
const storefront = path.join(dist, "client/storefront.html");
if (await exists(storefront)) {
  await copyFile(storefront, path.join(dist, "client/index.html"));
  await copyFile(storefront, path.join(dist, "index.html"));
}

console.log("[dist-sync] dist/ ready");
