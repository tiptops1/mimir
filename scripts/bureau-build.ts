/**
 * Le Bureau (C5) — assemble the vendored pixel-agents webview into public/bureau/.
 *
 * Steps:
 *  1. `npm run build` in vendor/pixel-agents/webview-ui (tsc + vite, base './')
 *  2. copy vendor/pixel-agents/dist/webview → public/bureau
 *  3. inject the acquireVsCodeApi postMessage shim into index.html (forces the
 *     SPA onto PostMessageTransport so the host page can drive it)
 *  4. replay the standalone server's `webviewReady` handshake at build time and
 *     freeze it to public/bureau/boot.json (assets, layout, settings, agents)
 *
 * Run with: npm run bureau:build  (requires `npm install` done once in
 * vendor/pixel-agents). Output is committed — Vercel never builds the vendor tree.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..");
const vendorRoot = path.join(repoRoot, "vendor", "pixel-agents");
const webviewDir = path.join(vendorRoot, "webview-ui");
const distWebview = path.join(vendorRoot, "dist", "webview");
const outDir = path.join(repoRoot, "public", "bureau");

// The Mimir agents: id + display name + the AgentEvent.module key each maps to.
const BUREAU_AGENTS: { id: number; name: string; module: string }[] = [
  { id: 1, name: "Heimdallr", module: "heimdallr" },
  { id: 2, name: "Huginn", module: "huginn" },
  { id: 3, name: "Muninn", module: "muninn" },
  { id: 4, name: "Nornir", module: "nornir" },
  { id: 5, name: "Bragi", module: "bragi" },
  { id: 6, name: "Forseti", module: "forseti" },
  { id: 7, name: "Odin", module: "odin" },
  { id: 8, name: "Thor", module: "thor" },
];

async function main() {
  // 1. Build the SPA
  console.log("[bureau] building vendored webview-ui...");
  execSync("npm run build", { cwd: webviewDir, stdio: "inherit" });

  // 2. Copy dist → public/bureau
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(distWebview, outDir, { recursive: true });

  // 3. Shim index.html: define acquireVsCodeApi before the bundle loads so the
  // SPA picks PostMessageTransport (see vendor webview-ui/src/runtime.ts).
  const indexPath = path.join(outDir, "index.html");
  // The SPA can send webviewReady before the Next host page has hydrated its
  // listener, so every outbound message is also queued; when the host mounts it
  // posts "bureau:drain" and the queue is redelivered (marked redelivery:true).
  const shim =
    `<script>(function(){var q=[];` +
    `function out(m,r){window.parent.postMessage({source:"bureau",message:m,redelivery:!!r},window.location.origin);}` +
    `window.addEventListener("message",function(e){if(e.data==="bureau:drain"){for(var i=0;i<q.length;i++)out(q[i],true);}});` +
    `window.acquireVsCodeApi=function(){var s;return{` +
    `postMessage:function(m){q.push(m);out(m,false);},` +
    `getState:function(){return s;},setState:function(v){s=v;}};};})();</script>`;
  const html = fs.readFileSync(indexPath, "utf8");
  if (!html.includes("<script")) throw new Error("no <script> tag found in vendored index.html");
  fs.writeFileSync(indexPath, html.replace("<script", `${shim}<script`), "utf8");

  // 4. Freeze the webviewReady handshake (mirrors vendor
  // server/src/clientMessageHandler.ts handleWebviewReady, minus persistence).
  // Import paths built at runtime so tsc never pulls the vendor tree into the
  // app's type-check (vendor/ is excluded from tsconfig); tsx resolves them.
  const vendorSrc = "../vendor/pixel-agents/server/src";
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { buildAssetCache } = (await import(`${vendorSrc}/assetReload.js`)) as any;
  const { claudeProvider } = (await import(
    `${vendorSrc}/providers/hook/claude/claude.js`
  )) as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  // buildAssetCache expects a root containing assets/ — webview-ui/public has it.
  const cache = await buildAssetCache(path.join(webviewDir, "public"), []);
  if (!cache.characters || !cache.furniture || !cache.defaultLayout) {
    throw new Error("asset cache incomplete — vendored assets missing?");
  }
  const version = (
    JSON.parse(fs.readFileSync(path.join(vendorRoot, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;

  const messages: unknown[] = [
    {
      type: "providerCapabilities",
      readingTools: [...claudeProvider.readingTools],
      subagentToolNames: [...claudeProvider.subagentToolNames],
    },
    { type: "characterSpritesLoaded", characters: cache.characters.characters },
  ];
  if (cache.pets) {
    messages.push({
      type: "petSpritesLoaded",
      pets: cache.pets.pets,
      petNames: cache.pets.manifests.map((m: { name: string }) => m.name),
    });
  }
  if (cache.floorTiles) messages.push({ type: "floorTilesLoaded", sprites: cache.floorTiles });
  if (cache.wallTiles) messages.push({ type: "wallTilesLoaded", sets: cache.wallTiles });
  if (cache.carpetTiles) messages.push({ type: "carpetTilesLoaded", sets: cache.carpetTiles });
  messages.push({
    type: "furnitureAssetsLoaded",
    catalog: cache.furniture.catalog,
    sprites: Object.fromEntries(cache.furniture.sprites),
  });
  // Vendor quirk: the webview buffers `existingAgents` and only materializes
  // characters inside the `layoutLoaded` handler — so agents must be announced
  // BEFORE the layout (unlike the live server's order), and `agentTeamInfo`
  // (names) after it, once the characters exist.
  messages.push({
    type: "existingAgents",
    agents: BUREAU_AGENTS.map((a) => a.id),
    agentMeta: {},
    folderNames: {},
    externalAgents: {},
  });
  messages.push({ type: "layoutLoaded", layout: cache.defaultLayout });
  messages.push({
    type: "settingsLoaded",
    soundEnabled: false,
    // Suppress the "Updated to vX.Y!" toast: the webview compares
    // major.minor of extensionVersion against lastSeenVersion verbatim.
    lastSeenVersion: version.split(".").slice(0, 2).join("."),
    extensionVersion: version,
    watchAllSessions: false,
    alwaysShowLabels: true, // show the Norse names by default
    hooksEnabled: true,
    hooksInfoShown: true, // suppress the hooks onboarding modal
    externalAssetDirectories: [],
    showAreas: false,
  });
  messages.push({ type: "areaMappingsLoaded", mappings: {} });
  for (const a of BUREAU_AGENTS) {
    messages.push({ type: "agentTeamInfo", id: a.id, agentName: a.name });
  }

  const boot = {
    vendor: "pixel-agents",
    version,
    agents: Object.fromEntries(BUREAU_AGENTS.map((a) => [a.module, a.id])),
    messages,
  };
  fs.writeFileSync(path.join(outDir, "boot.json"), JSON.stringify(boot), "utf8");
  const size = (fs.statSync(path.join(outDir, "boot.json")).size / 1024).toFixed(0);
  console.log(`[bureau] wrote public/bureau (boot.json ${size} kB, ${messages.length} messages)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
