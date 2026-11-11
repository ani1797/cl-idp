// Generates the "actually deployed" Azure production topology diagram from
// a single declarative layout, as:
//   1. canada-life-idp-azure-production-topology.svg   (static preview)
//   2. canada-life-idp-azure-production-topology.excalidraw (editable source)
//
// Regenerate after infra/ changes with:
//   node docs/architecture/generate-azure-production-topology-diagram.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.join(here, "assets", "azure-icons");
const svgOut = path.join(here, "canada-life-idp-azure-production-topology.svg");
const excalidrawOut = path.join(here, "canada-life-idp-azure-production-topology.excalidraw");

const C = {
  canvas: "#f7f9fc",
  ink: "#172b4d",
  muted: "#5b6b83",
  azure: "#0078d4",
  azureLight: "#eaf4ff",
  teal: "#008272",
  tealLight: "#e8f7f4",
  maroon: "#a20a29",
  maroonLight: "#fff0f3",
  gold: "#b08824",
  goldLight: "#fff8df",
  green: "#1e7b4d",
  greenLight: "#eaf8ef",
  purple: "#6b4fa1",
  purpleLight: "#f1edfb",
  gray: "#697386",
  grayLight: "#eef1f5",
  border: "#aeb8c5",
  white: "#ffffff",
};

// Azure Architecture Center style: connector lines are a single neutral
// color regardless of role (color is reserved for service-category icons
// and accents), with small numbered badges instead of long inline labels.
const NEUTRAL_LINE = "#4b5563";

const TONE_PALETTE = {
  azure: [C.azureLight, C.azure],
  teal: [C.tealLight, C.teal],
  maroon: [C.maroonLight, C.maroon],
  gold: [C.goldLight, C.gold],
  green: [C.greenLight, C.green],
  purple: [C.purpleLight, C.purple],
  gray: [C.grayLight, C.gray],
};

// ---------------------------------------------------------------------------
// Declarative layout — the single source of truth consumed by both the SVG
// and the .excalidraw renderers below.
// ---------------------------------------------------------------------------

const W = 2080;
const H = 1260;

const REGION_SPLIT_X = 970; // internal layout divider between the two visual zones (no longer a real region boundary)

const boundaries = [
  {
    id: "rg",
    x: 30, y: 90, w: 2020, h: 1130,
    title: "Resource group — single, self-contained",
    subtitle: "A tag-based policy exemption permits the public endpoints used in this blueprint (see \"Governance exemption\" below)",
    tone: "gray",
  },
  {
    id: "region",
    x: 60, y: 180, w: 1960, h: 990,
    title: "Canada Central — single Azure region",
    subtitle: "All platform resources co-located in one Canadian region for data residency",
    tone: "azure",
  },
];

const nodes = [
  // --- compute tier -----------------------------------------------------
  { id: "entra", x: 1090, y: 260, w: 900, h: 50, title: "Microsoft Entra ID — system-assigned managed identities", icon: "managed-identities", tone: "purple",
    lines: ["web / api / worker / Grafana / Foundry project — zero API keys"] },
  { id: "web", x: 1090, y: 480, w: 280, h: 140, title: "Web app (App Service, B1)", icon: "resource-groups", tone: "teal",
    lines: ["Linux container, Node.js front end", "pulls its image via AcrPull (MI)"] },
  { id: "api", x: 1400, y: 480, w: 280, h: 140, title: "API app (App Service, B1)", icon: "resource-groups", tone: "teal",
    lines: ["Linux container, Python API", "pulls its image via AcrPull (MI)"] },
  { id: "worker", x: 1710, y: 480, w: 280, h: 140, title: "Background worker (Function, Y1)", icon: "resource-groups", tone: "teal",
    lines: ["Linux Consumption, Python", "queue-triggered background jobs"] },
  { id: "storage", x: 1090, y: 660, w: 280, h: 140, title: "Storage Account", icon: "storage", tone: "teal",
    lines: ["Blob container + queue,", "also used as the Function App content store"] },
  { id: "vnet-note", x: 1400, y: 660, w: 600, h: 140, title: "Optional VNet integration", icon: "vnet", tone: "gray",
    lines: ["Regional VNet integration for the API/worker, only when a", "private authenticated SMTP relay is configured (needs an EP plan)"], dashed: true },

  // --- data / AI / security tier -----------------------------------------
  { id: "kv", x: 90, y: 230, w: 360, h: 140, title: "Key Vault (RBAC authZ)", icon: "key-vault", tone: "gold",
    lines: ["Secrets store: DB connection strings, signing", "secret, API tokens, SMTP password (if configured)"] },
  { id: "cosmos", x: 480, y: 230, w: 400, h: 140, title: "Cosmos DB for MongoDB (RU)", icon: "cosmos-db", tone: "azure",
    lines: ["Serverless, MongoDB-compatible API", "document store for application data"] },
  { id: "foundry", x: 90, y: 410, w: 790, h: 230, title: "Azure AI Foundry (AIServices account + project)", icon: "ai-foundry", tone: "maroon",
    lines: [
      "disableLocalAuth: true — Entra/RBAC only, no API keys",
      "Primary deployment: Content Understanding analyzer model",
      "Optional isolated judge model deployment + Agent Service",
      "custom prompt agent for automated quality review",
    ] },
  { id: "acr", x: 90, y: 680, w: 380, h: 130, title: "Container Registry", icon: "acr", tone: "azure",
    lines: ["Hosts the web/API application images,", "pulled by managed identity — no admin user/credentials"] },
  { id: "acs", x: 500, y: 680, w: 380, h: 130, title: "Communication Services Email", icon: "communication-services", tone: "gray",
    lines: ["Optional, non-production: Azure-managed", "domain SMTP AUTH for demo/testing only"], dashed: true },
  { id: "law", x: 90, y: 850, w: 380, h: 130, title: "Log Analytics Workspace", icon: "log-analytics", tone: "purple",
    lines: ["Central log/metric sink,", "diagnostic settings from every compute resource"] },
  { id: "appi", x: 500, y: 850, w: 380, h: 130, title: "Application Insights", icon: "app-insights", tone: "purple",
    lines: ["Workspace-based APM,", "+ Foundry account/project AppInsights connection"] },
  { id: "grafana", x: 90, y: 1020, w: 380, h: 130, title: "Azure Managed Grafana", icon: "grafana", tone: "gold",
    lines: ["Optional native dashboards", "over the Log Analytics workspace"], dashed: true },
  { id: "entra2", x: 500, y: 1020, w: 380, h: 130, title: "Governance exemption", icon: "policy", tone: "gray",
    lines: ["Tag-based policy exemption — documents an approved", "exception from public-network/local-auth policies"] },
];

const arrows = [
  { from: "web", to: "acr", label: "AcrPull (MI)", tone: "azure" },
  { from: "api", to: "acr", label: "AcrPull (MI)", tone: "azure" },
  { from: "api", to: "storage", label: "Blob/Queue Data Contributor", tone: "teal" },
  { from: "worker", to: "storage", label: "Blob/Queue Data Contributor", tone: "teal" },
  { from: "api", to: "kv", label: "Key Vault Secrets User", tone: "gold" },
  { from: "worker", to: "kv", label: "Key Vault Secrets User", tone: "gold" },
  { from: "web", to: "kv", label: "Secrets User (reserved)", tone: "gold", dashed: true },
  { from: "api", to: "cosmos", label: "connection string (KV ref)", tone: "azure" },
  { from: "worker", to: "cosmos", label: "connection string (KV ref)", tone: "azure" },
  { from: "api", to: "foundry", label: "Cognitive Services User", tone: "maroon" },
  { from: "worker", to: "foundry", label: "Cognitive Services User + Foundry User", tone: "maroon" },
  { from: "grafana", to: "law", label: "Monitoring Reader (MI)", tone: "purple", dashed: true },
  { from: "foundry", to: "appi", label: "project MI: Log Analytics Reader + Privileged Monitoring Data Reader", tone: "purple" },
];

// Numbered legend entries (one per arrow, in declaration order) — Azure
// Architecture Center diagrams keep connectors unlabeled/neutral and move
// the role/permission detail into a reference legend instead of inline text,
// which is what keeps busy RBAC-heavy diagrams readable.
const legend = arrows.map((a, i) => ({
  n: i + 1,
  tone: a.tone,
  text: `${a.from} \u2192 ${a.to}: ${a.label}`,
}));

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const iconCache = new Map();
function iconData(name) {
  if (!iconCache.has(name)) {
    const bytes = fs.readFileSync(path.join(iconDir, `${name}.svg`));
    iconCache.set(name, `data:image/svg+xml;base64,${bytes.toString("base64")}`);
  }
  return iconCache.get(name);
}

function nodeCenter(node) {
  return [node.x + node.w / 2, node.y + node.h / 2];
}

function edgePoint(node, towards, nudge = 0) {
  // Pick the edge midpoint (optionally nudged along the edge) on the side
  // closest to the target center, so parallel edges don't fully overlap.
  const [cx, cy] = nodeCenter(node);
  const [tx, ty] = towards;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? [node.x + node.w, cy + nudge] : [node.x, cy + nudge];
  }
  return dy > 0 ? [cx + nudge, node.y + node.h] : [cx + nudge, node.y];
}

// Row-1 compute nodes (web/api/worker) sit side by side, so a direct
// horizontal line toward the region seam would cut through neighboring
// boxes. Route those through the clear corridor strip just below the
// Entra ID banner instead.
const TOP_CORRIDOR_SOURCES = new Set(["web", "api", "worker"]);
const CORRIDOR_Y = 400; // wide gap between the Entra banner (ends y=310) and row-1 tops (y=480)

// Row-1 (web/api/worker, y 480-620) and row-2 (storage/vnet-note, y 660-800)
// are columns-misaligned, so route between them via the empty inter-row
// strip instead of a diagonal that cuts through a sibling box.
const COMPUTE_ROW1 = new Set(["web", "api", "worker"]);
const COMPUTE_ROW2 = new Set(["storage", "vnet-note"]);
const ROW_GAP_Y = 640;

// Builds an orthogonal (elbowed) route between two nodes so lines travel
// around boxes instead of diagonally through them, with a small per-arrow
// lane offset so parallel edges stay visually distinct. Returns
// { points, labelSegment } where labelSegment indexes the segment
// (points[i] -> points[i+1]) guaranteed to be in open space for a label.
function routeArrow(from, to, laneOffset) {
  const fromLeftRegion = from.x + from.w <= REGION_SPLIT_X;
  const toLeftRegion = to.x + to.w <= REGION_SPLIT_X;
  if (fromLeftRegion !== toLeftRegion) {
    const [, cy2] = nodeCenter(to);
    const seamX = REGION_SPLIT_X + laneOffset;
    const p2 = toLeftRegion ? [to.x + to.w, cy2] : [to.x, cy2];

    if (TOP_CORRIDOR_SOURCES.has(from.id)) {
      const [cx] = nodeCenter(from);
      const corridorY = CORRIDOR_Y + Math.max(-75, Math.min(75, laneOffset * 1.6));
      const p1 = [cx, from.y];
      const points = [p1, [cx, corridorY], [seamX, corridorY], [seamX, cy2], p2];
      // Several arrows from the same source share this corridor row at
      // slightly different corridorY values, which can still leave their
      // badges almost touching; spread the badge along the segment too.
      const labelT = 0.5 + Math.max(-0.35, Math.min(0.35, laneOffset / 100));
      return { points, labelSegment: 1, labelT };
    }

    const [, cy1] = nodeCenter(from);
    const p1 = fromLeftRegion ? [from.x + from.w, cy1] : [from.x, cy1];
    const points = [p1, [seamX, cy1], [seamX, cy2], p2];
    return { points, labelSegment: 1, labelT: 0.5 };
  }

  if (COMPUTE_ROW1.has(from.id) && COMPUTE_ROW2.has(to.id)) {
    const [cxFrom] = nodeCenter(from);
    const [cxTo] = nodeCenter(to);
    const gapY = ROW_GAP_Y + (from.id === "worker" ? -10 : from.id === "api" ? 10 : 0);
    const points = [[cxFrom, from.y + from.h], [cxFrom, gapY], [cxTo, gapY], [cxTo, to.y]];
    return { points, labelSegment: 1, labelT: 0.5 };
  }

  const p1 = edgePoint(from, nodeCenter(to), laneOffset);
  const p2 = edgePoint(to, nodeCenter(from), laneOffset);
  const sameRow = Math.abs(p1[1] - p2[1]) < 6;
  const sameCol = Math.abs(p1[0] - p2[0]) < 6;
  if (sameRow || sameCol) return { points: [p1, p2], labelSegment: 0, labelT: 0.5 };

  const fromExitsHorizontally = p1[1] === from.y || p1[1] === from.y + from.h ? false : true;
  // Exit horizontally from `from` then drop/rise into `to`'s edge; label the
  // longer of the two segments so it lands in open space, not a tight gap.
  const bend = fromExitsHorizontally ? [p2[0], p1[1]] : [p1[0], p2[1]];
  const points = [p1, bend, p2];
  const seg0Len = Math.hypot(bend[0] - p1[0], bend[1] - p1[1]);
  const seg1Len = Math.hypot(p2[0] - bend[0], p2[1] - bend[1]);
  return { points, labelSegment: seg1Len > seg0Len ? 1 : 0, labelT: 0.5 };
}

const LEGEND = { x: 1060, y: 860, w: 960, h: 290 };

function renderSvg() {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`);
  out.push('<title id="title">Canada Life IDP Azure reference architecture (Canada, single region)</title>');
  out.push('<desc id="desc">A general-purpose, single-Canada-region blueprint: App Service web/api, Function App worker, Cosmos DB for MongoDB, Key Vault, Azure AI Foundry with Content Understanding and an optional judge agent, Container Registry, Log Analytics/Application Insights, optional Managed Grafana and an optional demo email relay, with least-privilege RBAC edges between them.</desc>');
  out.push(`<defs>
  <marker id="arrow-neutral" markerWidth="9" markerHeight="9" refX="7" refY="2.5" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,5 L7,2.5 z" fill="${NEUTRAL_LINE}"/>
  </marker></defs>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.white}"/>`);

  out.push(`<text x="36" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="27" font-weight="700" fill="${C.ink}">Canada Life IDP — Azure Reference Architecture (Canada)</text>`);
  out.push(`<text x="36" y="66" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="${C.muted}">General-purpose, single-region blueprint for the AI document-processing platform — least-privilege RBAC throughout</text>`);

  // Azure Architecture Center style: boundaries (resource group / region) are
  // unfilled, dashed outlines with a small label tab — not solid color blocks.
  for (const b of boundaries) {
    const [, stroke] = TONE_PALETTE[b.tone];
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="10 6"/>`);
    const tabW = Math.min(b.w - 20, b.title.length * 10.2 + 28);
    out.push(`<rect x="${b.x + 10}" y="${b.y - 14}" width="${tabW}" height="28" rx="4" fill="${C.white}" stroke="${stroke}" stroke-width="2"/>`);
    out.push(`<text x="${b.x + 22}" y="${b.y + 5}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="${stroke}">${esc(b.title)}</text>`);
    if (b.subtitle) {
      out.push(`<text x="${b.x + 14}" y="${b.y + 40}" font-family="Segoe UI, Arial, sans-serif" font-size="12" font-style="italic" fill="${C.muted}">${esc(b.subtitle)}</text>`);
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const laneCounters = {};

  // Nodes: white card, thin gray border, colored left accent bar (keeps the
  // category color cue without turning every box into a solid color block).
  for (const n of nodes) {
    const [, accent] = TONE_PALETTE[n.tone];
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${C.white}" stroke="${C.border}" stroke-width="1.5"${n.dashed ? ' stroke-dasharray="6 5"' : ""}/>`);
    out.push(`<rect x="${n.x}" y="${n.y}" width="5" height="${n.h}" fill="${accent}"${n.dashed ? ' opacity="0.6"' : ""}/>`);
    out.push(`<image x="${n.x + 16}" y="${n.y + 14}" width="36" height="36" href="${iconData(n.icon)}"/>`);
    out.push(`<text x="${n.x + 64}" y="${n.y + 32}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="${C.ink}">${esc(n.title)}</text>`);
    out.push(`<text x="${n.x + 64}" y="${n.y + 52}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${C.muted}">`);
    n.lines.forEach((line, idx) => {
      out.push(`<tspan x="${n.x + 64}" dy="${idx === 0 ? 0 : 16}">${esc(line)}</tspan>`);
    });
    out.push("</text>");
  }

  // Connectors: a single neutral line color/weight for every edge (color is
  // not overloaded with meaning here); a small numbered badge references the
  // legend panel instead of inline text, so busy fan-out doesn't collide.
  for (const a of arrows) {
    const from = byId[a.from];
    const to = byId[a.to];
    const n = (laneCounters[a.from] = (laneCounters[a.from] || 0) + 1);
    const laneOffset = ((n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * 12);
    const { points: pts, labelSegment, labelT } = routeArrow(from, to, laneOffset);
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${NEUTRAL_LINE}" stroke-width="1.75"${a.dashed ? ' stroke-dasharray="7 5"' : ""} marker-end="url(#arrow-neutral)"/>`);
    const idx = arrows.indexOf(a);
    const [x1, y1] = pts[labelSegment];
    const [x2, y2] = pts[labelSegment + 1];
    const mx = x1 + (x2 - x1) * labelT;
    const my = y1 + (y2 - y1) * labelT;
    const [, badgeColor] = TONE_PALETTE[a.tone];
    out.push(`<circle cx="${mx}" cy="${my}" r="10" fill="${C.white}" stroke="${badgeColor}" stroke-width="1.75"/>`);
    out.push(`<text x="${mx}" y="${my + 4}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" fill="${badgeColor}">${idx + 1}</text>`);
  }

  // Legend panel: full RBAC/data-plane edge descriptions live here instead of
  // on the diagram lines themselves.
  out.push(`<rect x="${LEGEND.x}" y="${LEGEND.y}" width="${LEGEND.w}" height="${LEGEND.h}" rx="6" fill="${C.grayLight}" stroke="${C.border}" stroke-width="1.5"/>`);
  out.push(`<text x="${LEGEND.x + 18}" y="${LEGEND.y + 28}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="${C.ink}">RBAC / data-plane access legend</text>`);
  const legendCols = 2;
  const colW = (LEGEND.w - 36) / legendCols;
  const rowH = 24;
  const perCol = Math.ceil(legend.length / legendCols);
  legend.forEach((item, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const lx = LEGEND.x + 18 + col * colW;
    const ly = LEGEND.y + 54 + row * rowH;
    const [, badgeColor] = TONE_PALETTE[item.tone];
    out.push(`<circle cx="${lx + 9}" cy="${ly - 4}" r="9" fill="${C.white}" stroke="${badgeColor}" stroke-width="1.5"/>`);
    out.push(`<text x="${lx + 9}" y="${ly}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" font-weight="700" fill="${badgeColor}">${item.n}</text>`);
    out.push(`<text x="${lx + 26}" y="${ly}" font-family="Segoe UI, Arial, sans-serif" font-size="11.5" fill="${C.ink}">${esc(item.text.length > 58 ? item.text.slice(0, 57) + "…" : item.text)}</text>`);
  });

  out.push(`<text x="36" y="${H - 16}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${C.muted}">Official Microsoft Azure Architecture Center icons. Dashed boxes/edges denote optional or conditional components (e.g. an optional judge agent, demo email relay, private networking, Grafana).</text>`);
  out.push("</svg>");
  fs.writeFileSync(svgOut, out.join("\n"));
  console.log(`Wrote ${svgOut}`);
}

// ---------------------------------------------------------------------------
// .excalidraw (native, editable) renderer
// ---------------------------------------------------------------------------

let seedCounter = 1;
function nextSeed() {
  return 1000000 + seedCounter++;
}

function baseProps(overrides = {}) {
  return {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    updated: Date.now(),
    roundness: null,
    ...overrides,
  };
}

function rectElement(id, x, y, w, h, stroke, fill, dashed) {
  return {
    id,
    type: "rectangle",
    x, y, width: w, height: h,
    ...baseProps({
      strokeColor: stroke,
      backgroundColor: fill,
      fillStyle: "solid",
      strokeStyle: dashed ? "dashed" : "solid",
      roundness: { type: 3 },
    }),
  };
}

function textElement(id, x, y, w, h, text, size, color, weight) {
  return {
    id,
    type: "text",
    x, y, width: w, height: h,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 2,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    ...baseProps({ strokeColor: color, strokeWidth: weight >= 700 ? 2 : 1 }),
  };
}

function imageElement(id, x, y, size, fileId) {
  return {
    id,
    type: "image",
    x, y, width: size, height: size,
    fileId,
    status: "saved",
    scale: [1, 1],
    crop: null,
    ...baseProps({ strokeColor: "transparent" }),
  };
}

function ellipseElement(id, x, y, w, h, stroke, fill) {
  return {
    id,
    type: "ellipse",
    x, y, width: w, height: h,
    ...baseProps({ strokeColor: stroke, backgroundColor: fill, fillStyle: "solid" }),
  };
}

function arrowElement(id, points, stroke, dashed) {
  const [x, y] = points[0];
  const relPoints = points.map(([px, py]) => [px - x, py - y]);
  return {
    id,
    type: "arrow",
    x, y,
    width: Math.max(1, Math.abs(relPoints[relPoints.length - 1][0])),
    height: Math.max(1, Math.abs(relPoints[relPoints.length - 1][1])),
    points: relPoints,
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
    ...baseProps({ strokeColor: stroke, strokeStyle: dashed ? "dashed" : "solid" }),
  };
}

function renderExcalidraw() {
  const elements = [];
  const files = {};

  // Boundaries: unfilled dashed outline + a small label tab, matching the
  // Azure Architecture Center convention (color reserved for accents/icons,
  // not full box fills).
  for (const b of boundaries) {
    const [, stroke] = TONE_PALETTE[b.tone];
    const rid = `bound-${b.id}`;
    elements.push(rectElement(rid, b.x, b.y, b.w, b.h, stroke, "transparent", true));
    const tabW = Math.min(b.w - 20, b.title.length * 10.2 + 28);
    elements.push(rectElement(`${rid}-tab`, b.x + 10, b.y - 14, tabW, 28, stroke, C.white, false));
    elements.push(textElement(`${rid}-title`, b.x + 22, b.y - 9, tabW - 24, 20, b.title, 14, stroke, 700));
    if (b.subtitle) {
      elements.push(textElement(`${rid}-sub`, b.x + 14, b.y + 30, b.w - 28, 20, b.subtitle, 12, C.muted, 400));
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const laneCounters = {};

  // Nodes: white card + thin gray border + a colored left accent bar.
  for (const n of nodes) {
    const [, accent] = TONE_PALETTE[n.tone];
    const rid = `node-${n.id}`;
    elements.push(rectElement(rid, n.x, n.y, n.w, n.h, C.border, C.white, n.dashed));
    elements.push(rectElement(`${rid}-accent`, n.x, n.y, 5, n.h, accent, accent, false));
    const bytes = fs.readFileSync(path.join(iconDir, `${n.icon}.svg`));
    const fileId = `file-${n.icon}`;
    if (!files[fileId]) {
      files[fileId] = {
        id: fileId,
        mimeType: "image/svg+xml",
        dataURL: `data:image/svg+xml;base64,${bytes.toString("base64")}`,
        created: Date.now(),
      };
    }
    elements.push(imageElement(`${rid}-icon`, n.x + 16, n.y + 14, 36, fileId));
    elements.push(textElement(`${rid}-title`, n.x + 64, n.y + 16, n.w - 76, 20, n.title, 15, C.ink, 700));
    elements.push(textElement(`${rid}-lines`, n.x + 64, n.y + 38, n.w - 76, n.h - 44, n.lines.join("\n"), 12, C.muted, 400));
  }

  // Connectors: single neutral color/weight + a small numbered badge
  // (referencing the legend panel) instead of inline text labels.
  for (const a of arrows) {
    const from = byId[a.from];
    const to = byId[a.to];
    const n = (laneCounters[a.from] = (laneCounters[a.from] || 0) + 1);
    const laneOffset = ((n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * 12);
    const { points: pts, labelSegment, labelT } = routeArrow(from, to, laneOffset);
    const idx = arrows.indexOf(a);
    const id = `arrow-${a.from}-${a.to}-${idx}`;
    elements.push(arrowElement(id, pts, NEUTRAL_LINE, a.dashed));
    const [x1, y1] = pts[labelSegment];
    const [x2, y2] = pts[labelSegment + 1];
    const mx = x1 + (x2 - x1) * labelT;
    const my = y1 + (y2 - y1) * labelT;
    const [, badgeColor] = TONE_PALETTE[a.tone];
    elements.push(ellipseElement(`${id}-badge`, mx - 10, my - 10, 20, 20, badgeColor, C.white));
    elements.push(textElement(`${id}-badge-n`, mx - 10, my - 8, 20, 16, String(idx + 1), 11, badgeColor, 700));
  }

  // Legend panel: full RBAC/data-plane edge descriptions.
  elements.push(rectElement("legend-box", LEGEND.x, LEGEND.y, LEGEND.w, LEGEND.h, C.border, C.grayLight, false));
  elements.push(textElement("legend-title", LEGEND.x + 18, LEGEND.y + 14, LEGEND.w - 36, 22, "RBAC / data-plane access legend", 15, C.ink, 700));
  const legendCols = 2;
  const colW = (LEGEND.w - 36) / legendCols;
  const rowH = 24;
  const perCol = Math.ceil(legend.length / legendCols);
  legend.forEach((item, i) => {
    const col = Math.floor(i / perCol);
    const row = i % perCol;
    const lx = LEGEND.x + 18 + col * colW;
    const ly = LEGEND.y + 46 + row * rowH;
    const [, badgeColor] = TONE_PALETTE[item.tone];
    elements.push(ellipseElement(`legend-${item.n}-badge`, lx, ly, 18, 18, badgeColor, C.white));
    elements.push(textElement(`legend-${item.n}-n`, lx, ly + 1, 18, 14, String(item.n), 10, badgeColor, 700));
    elements.push(textElement(`legend-${item.n}-text`, lx + 24, ly, colW - 28, 18, item.text, 11.5, C.ink, 400));
  });

  elements.push(textElement("doc-title", 36, 20, 1200, 32, "Canada Life IDP — Azure Reference Architecture (Canada)", 24, C.ink, 700));
  elements.push(textElement("doc-subtitle", 36, 54, 1200, 20, "General-purpose, single-region blueprint for the AI document-processing platform", 13, C.muted, 400));
  elements.push(textElement("doc-footer", 36, H - 28, 1600, 18,
    "Dashed boxes/edges denote optional or conditional components (e.g. an optional judge agent, demo email relay, private networking, Grafana). Official Microsoft Azure Architecture Center icons.",
    12, C.muted, 400));

  const scene = {
    type: "excalidraw",
    version: 2,
    source: "https://github.com/ani1797/cl-idp docs/architecture/generate-azure-production-topology-diagram.mjs",
    elements,
    appState: {
      gridSize: null,
      viewBackgroundColor: C.white,
    },
    files,
  };

  fs.writeFileSync(excalidrawOut, JSON.stringify(scene, null, 2));
  console.log(`Wrote ${excalidrawOut}`);
}

renderSvg();
renderExcalidraw();
