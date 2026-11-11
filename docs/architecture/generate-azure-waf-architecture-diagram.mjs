// Generates the "concept" Azure Well-Architected Framework diagram — the
// exact same accurate node/arrow/RBAC set as
// generate-azure-production-topology-diagram.mjs (both are derived 1:1 from
// infra/main.bicep + infra/modules/*.bicep; no node or edge here exists
// that isn't an actual Bicep resource/role assignment), minus the
// monitoring/observability tier (Log Analytics, Application Insights,
// Grafana — intentionally out of scope for this diagram), restyled after
// the Azure Architecture Center's nested-boundary convention instead of
// this folder's left-accent-bar card style: solid pastel-filled resource-
// group/region boundaries, icon-over-label resource boxes (no bullet
// descriptions — detail lives in the numbered RBAC legend instead), and a
// WAF-pillar summary panel. Outputs:
//   1. canada-life-idp-azure-waf-architecture.svg          (static preview)
//   2. canada-life-idp-azure-waf-architecture.excalidraw   (editable source)
//
// Re-run after any infra/ change (and keep in sync with
// generate-azure-production-topology-diagram.mjs, which is the ground truth
// this script's node/arrow set is derived from):
//
//   node docs/architecture/generate-azure-waf-architecture-diagram.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.join(here, "assets", "azure-icons");
const svgOut = path.join(here, "canada-life-idp-azure-waf-architecture.svg");
const excalidrawOut = path.join(here, "canada-life-idp-azure-waf-architecture.excalidraw");

const C = {
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
  purple: "#6b4fa1",
  purpleLight: "#f1edfb",
  gray: "#697386",
  grayLight: "#eef1f5",
  border: "#aeb8c5",
  white: "#ffffff",
  rgFill: "#fdf1e4",
  rgBorder: "#d9822b",
  regionFill: "#eceef7",
  regionBorder: "#8f8fb3",
};

// Single neutral connector color — Architecture Center style reserves color
// for the node/icon category, not the connector itself; a small numbered
// badge on each line references the RBAC legend panel instead of inline text.
const NEUTRAL_LINE = "#4b5563";

const TONE_PALETTE = {
  azure: [C.azureLight, C.azure],
  teal: [C.tealLight, C.teal],
  maroon: [C.maroonLight, C.maroon],
  gold: [C.goldLight, C.gold],
  purple: [C.purpleLight, C.purple],
  gray: [C.grayLight, C.gray],
};

const PILLAR_COLOR = {
  Reliability: "#0078d4",
  Security: "#a20a29",
  "Cost Optimization": "#b08824",
  "Operational Excellence": "#6b4fa1",
  "Performance Efficiency": "#008272",
};

// ---------------------------------------------------------------------------
// Declarative layout — identical node/arrow grid to
// generate-azure-production-topology-diagram.mjs, minus the monitoring tier
// (law/appi/grafana nodes + their edges) and the governance-exemption node
// (out of scope per user request — this diagram focuses on the deployed
// service topology, not policy/compliance details).
// ---------------------------------------------------------------------------

const W = 2080;
const H = 1510;

const REGION_SPLIT_X = 970; // internal layout divider between the two visual zones (no longer a real region boundary)

const boundaries = [
  {
    id: "rg",
    x: 30, y: 90, w: 2020, h: 1100,
    title: "Resource group — single, self-contained",
    subtitle: "",
    tone: "gray",
  },
  {
    id: "region",
    x: 60, y: 170, w: 1960, h: 980,
    title: "Canada Central — single Azure region",
    subtitle: "All platform resources co-located in one Canadian region for data residency",
    tone: "azure",
  },
];

// Left-column rows are spaced with deliberate ~70px gaps between them
// (kv/cosmos bottom 360 → gap → foundry top 430; foundry bottom 640 → gap →
// acr/acs top 710) so routeArrow() has a clear, box-free horizontal lane to
// route arrows into kv/acr from below/above instead of cutting through the
// neighboring box that shares their row (cosmos sits right of kv; acs sits
// right of acr).
const nodes = [
  // --- compute tier -----------------------------------------------------
  { id: "entra", x: 1090, y: 260, w: 900, h: 50, title: "Microsoft Entra ID — system-assigned managed identities", icon: "managed-identities", tone: "purple" },
  { id: "web", x: 1090, y: 480, w: 280, h: 140, title: "Web app\n(App Service, B1)", icon: "resource-groups", tone: "teal" },
  { id: "api", x: 1400, y: 480, w: 280, h: 140, title: "API app\n(App Service, B1)", icon: "resource-groups", tone: "teal" },
  { id: "worker", x: 1710, y: 480, w: 280, h: 140, title: "Background worker\n(Function, Y1)", icon: "resource-groups", tone: "teal" },
  { id: "storage", x: 1090, y: 660, w: 280, h: 140, title: "Storage account\n(blob + queue)", icon: "storage", tone: "teal" },
  { id: "vnet-note", x: 1400, y: 660, w: 600, h: 140, title: "Optional VNet integration\n(private SMTP relay egress only, needs an EP plan)", icon: "vnet", tone: "gray", dashed: true },

  // --- data / AI / security tier -----------------------------------------
  { id: "kv", x: 90, y: 230, w: 360, h: 130, title: "Key Vault\n(RBAC authorization)", icon: "key-vault", tone: "gold" },
  { id: "cosmos", x: 480, y: 230, w: 400, h: 130, title: "Cosmos DB for MongoDB\n(serverless)", icon: "cosmos-db", tone: "azure" },
  { id: "foundry", x: 90, y: 430, w: 790, h: 210, title: "Azure AI Foundry — Content Understanding analyzer\n(disableLocalAuth: true; + optional isolated judge model & Agent Service)", icon: "ai-foundry", tone: "maroon" },
  { id: "acr", x: 90, y: 710, w: 380, h: 120, title: "Container Registry\n(web/API application images)", icon: "acr", tone: "azure" },
  { id: "acs", x: 500, y: 710, w: 380, h: 120, title: "Communication Services Email\n(optional SMTP relay)", icon: "communication-services", tone: "gray", dashed: true },

  // --- monitoring tier ----------------------------------------------------
  { id: "law", x: 90, y: 850, w: 380, h: 120, title: "Log Analytics Workspace\n(central log/metric sink)", icon: "log-analytics", tone: "purple" },
  { id: "appi", x: 500, y: 850, w: 380, h: 120, title: "Application Insights\n(workspace-based APM)", icon: "app-insights", tone: "purple" },
  { id: "grafana", x: 90, y: 990, w: 380, h: 120, title: "Azure Managed Grafana\n(optional dashboards)", icon: "grafana", tone: "gold", dashed: true },
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
  { from: "foundry", to: "appi", label: "project MI: Log Analytics Reader + Privileged Monitoring Data Reader", tone: "purple" },
  { from: "grafana", to: "law", label: "Monitoring Reader + Log Analytics Reader (MI)", tone: "purple", dashed: true },
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

const PILLAR_SUMMARY = [
  { pillar: "Reliability", text: "Serverless Cosmos DB + Consumption Function App scale with load; no single points of failure in the data tier" },
  { pillar: "Security", text: "RBAC-only access everywhere \u2014 no account keys/API keys; Key Vault-brokered secrets; disableLocalAuth on AI Foundry" },
  { pillar: "Cost Optimization", text: "Consumption/serverless billing (Function App, Cosmos RU); B1 App Service plans sized for current load" },
  { pillar: "Operational Excellence", text: "Declarative Bicep IaC, least-privilege RBAC modules, no manual portal configuration" },
  { pillar: "Performance Efficiency", text: "Independently scalable compute tier \u2014 web/API/worker each own their own hosting plan" },
];

// ---------------------------------------------------------------------------
// Shared geometry helpers (identical routing to
// generate-azure-production-topology-diagram.mjs, reused verbatim since it
// already avoids cutting lines through boxes for this exact node grid).
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
  const [cx, cy] = nodeCenter(node);
  const [tx, ty] = towards;
  const dx = tx - cx;
  const dy = ty - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? [node.x + node.w, cy + nudge] : [node.x, cy + nudge];
  }
  return dy > 0 ? [cx + nudge, node.y + node.h] : [cx + nudge, node.y];
}

const TOP_CORRIDOR_SOURCES = new Set(["web", "api", "worker"]);
const CORRIDOR_Y = 400;

const COMPUTE_ROW1 = new Set(["web", "api", "worker"]);
const COMPUTE_ROW2 = new Set(["storage", "vnet-note"]);
const ROW_GAP_Y = 640;

function routeArrow(from, to, laneOffset, gapLane = 0) {
  const fromLeftRegion = from.x + from.w <= REGION_SPLIT_X;
  const toLeftRegion = to.x + to.w <= REGION_SPLIT_X;
  if (fromLeftRegion !== toLeftRegion) {
    // kv and acr each share a row with a wider neighbor box to their right
    // (cosmos, acs) that isn't an arrow endpoint — entering them from the
    // right edge at row-center would cut straight through that neighbor.
    // Instead, route through the dedicated box-free gap above/below their
    // row and drop/rise straight into their top/bottom edge. gapLane is a
    // small per-target local index (0, 1, 2...) so the 2-3 arrows sharing
    // one target's gap fan out evenly, independent of where each arrow
    // falls in the full (unrelated) global arrow ordering.
    if (TOP_CORRIDOR_SOURCES.has(from.id) && (to.id === "kv" || to.id === "acr")) {
      const [cxFrom] = nodeCenter(from);
      const [cxTo] = nodeCenter(to);
      const enterFromBelow = to.id === "kv"; // kv's free gap is below it (above foundry); acr's is above it (below foundry)
      const gapCenter = enterFromBelow ? 395 : 690;
      const gapY = gapCenter + (gapLane - 1) * 18;
      const entryPoint = enterFromBelow ? [cxTo, to.y + to.h] : [cxTo, to.y];
      // Exit the "from" box on whichever edge actually faces the gap — top
      // edge when the gap sits above it (kv, acr via the upper corridor),
      // bottom edge when the gap sits below it (acr's gap is below the
      // compute row) — otherwise the line cuts straight through the box.
      const exitY = gapY < from.y ? from.y : from.y + from.h;
      const points = [[cxFrom, exitY], [cxFrom, gapY], [cxTo, gapY], entryPoint];
      const labelT = 0.5 + Math.max(-0.35, Math.min(0.35, laneOffset / 100));
      return { points, labelSegment: 1, labelT };
    }

    // cosmos and foundry each get their own corridor/seam band (offset by
    // target, not just by gapLane) so their same-shaped 2-arrow groups
    // don't land on identical coordinates and hide one another.
    const TARGET_BAND = { cosmos: -45, foundry: 45 };
    const band = TARGET_BAND[to.id] || 0;
    const [, cy2] = nodeCenter(to);
    const seamX = REGION_SPLIT_X + band + (gapLane - 0.5) * 40;
    const p2 = toLeftRegion ? [to.x + to.w, cy2] : [to.x, cy2];

    if (TOP_CORRIDOR_SOURCES.has(from.id)) {
      const [cx] = nodeCenter(from);
      const corridorY = CORRIDOR_Y + band + (gapLane - 0.5) * 30;
      const p1 = [cx, from.y];
      const points = [p1, [cx, corridorY], [seamX, corridorY], [seamX, cy2], p2];
      const labelT = 0.35 + gapLane * 0.3;
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

  // Monitoring-tier edges (foundry→appi, grafana→law) stay within the left
  // column across several stacked rows — route straight down the box-free
  // seam between acr/acs (x≈485) instead of applying the global lane nudge,
  // which would otherwise drag the line sideways through acr or acs.
  if (from.id === "foundry" && to.id === "appi") {
    const seamX = 485;
    const [, cyTo] = nodeCenter(to);
    const points = [[seamX, from.y + from.h], [seamX, cyTo], [to.x, cyTo]];
    return { points, labelSegment: 1, labelT: 0.5 };
  }
  if (from.id === "grafana" && to.id === "law") {
    const [cx] = nodeCenter(from);
    const points = [[cx, from.y], [cx, to.y + to.h]];
    return { points, labelSegment: 0, labelT: 0.5 };
  }

  const p1 = edgePoint(from, nodeCenter(to), laneOffset);
  const p2 = edgePoint(to, nodeCenter(from), laneOffset);
  const sameRow = Math.abs(p1[1] - p2[1]) < 6;
  const sameCol = Math.abs(p1[0] - p2[0]) < 6;
  if (sameRow || sameCol) return { points: [p1, p2], labelSegment: 0, labelT: 0.5 };

  const fromExitsHorizontally = p1[1] !== from.y && p1[1] !== from.y + from.h;
  const bend = fromExitsHorizontally ? [p2[0], p1[1]] : [p1[0], p2[1]];
  const points = [p1, bend, p2];
  const seg0Len = Math.hypot(bend[0] - p1[0], bend[1] - p1[1]);
  const seg1Len = Math.hypot(p2[0] - bend[0], p2[1] - bend[1]);
  return { points, labelSegment: seg1Len > seg0Len ? 1 : 0, labelT: 0.5 };
}

const LEGEND = { x: 60, y: 1210, w: 1180, h: 260 };
const PILLAR_BOX = { x: 1260, y: 1210, w: 760, h: 260 };

function wrapTitle(title) {
  return title.split("\n");
}

// ---------------------------------------------------------------------------
// SVG renderer
// ---------------------------------------------------------------------------

function renderSvg() {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`);
  out.push('<title id="title">Canada Life IDP Platform — Azure architecture</title>');
  out.push('<desc id="desc">The same single-resource-group Azure deployment as the production topology diagram (App Service web/api, Function App worker, Cosmos DB for MongoDB, Key Vault, Azure AI Foundry with Content Understanding and an optional judge agent, Container Registry) with least-privilege RBAC edges, organized against the Well-Architected Framework pillars. Monitoring/observability intentionally out of scope.</desc>');
  out.push(`<defs>
  <marker id="arrow-neutral" markerWidth="9" markerHeight="9" refX="7" refY="2.5" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,5 L7,2.5 z" fill="${NEUTRAL_LINE}"/>
  </marker></defs>`);
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.white}"/>`);

  out.push(`<text x="36" y="42" font-family="Segoe UI, Arial, sans-serif" font-size="27" font-weight="700" fill="${C.ink}">Canada Life IDP Platform</text>`);
  out.push(`<text x="36" y="66" font-family="Segoe UI, Arial, sans-serif" font-size="15" fill="${C.muted}">Azure architecture, organized against the Well-Architected Framework pillars</text>`);

  // Boundaries: solid pastel fills (Azure Architecture Center nested-
  // boundary convention), drawn outer-to-inner so the inner tint paints
  // over the outer one.
  for (const b of boundaries) {
    const fill = b.id === "rg" ? C.rgFill : C.regionFill;
    const stroke = b.id === "rg" ? C.rgBorder : C.regionBorder;
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    out.push(`<text x="${b.x + 14}" y="${b.y + 22}" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700" fill="${stroke}">${esc(b.title)}</text>`);
    if (b.subtitle) {
      out.push(`<text x="${b.x + 14}" y="${b.y + 40}" font-family="Segoe UI, Arial, sans-serif" font-size="11.5" font-style="italic" fill="${C.muted}">${esc(b.subtitle)}</text>`);
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Nodes: pastel tint fill per category (reusing the same tone a card's
  // accent bar used to carry), icon centered on top, label centered below —
  // no bullet description lines, matching the reference's minimal labeling.
  for (const n of nodes) {
    const [fill, stroke] = TONE_PALETTE[n.tone];
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${n.dashed ? ' stroke-dasharray="7 5"' : ""}/>`);
    const lines = wrapTitle(n.title);
    if (n.id === "entra") {
      // Wide identity banner: icon on the left, label to its right, since
      // this box is short and wide, not square.
      out.push(`<image x="${n.x + 14}" y="${n.y + n.h / 2 - 16}" width="32" height="32" href="${iconData(n.icon)}"/>`);
      out.push(`<text x="${n.x + 60}" y="${n.y + n.h / 2 + 5}" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="${C.ink}">${esc(n.title)}</text>`);
    } else {
      out.push(`<image x="${n.x + n.w / 2 - 18}" y="${n.y + 14}" width="36" height="36" href="${iconData(n.icon)}"/>`);
      const textTop = n.y + 66;
      out.push(`<text x="${n.x + n.w / 2}" y="${textTop}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="${C.ink}">`);
      lines.forEach((line, idx) => out.push(`<tspan x="${n.x + n.w / 2}" dy="${idx === 0 ? 0 : 17}">${esc(line)}</tspan>`));
      out.push("</text>");
    }
  }

  // Connectors: neutral line + numbered badge referencing the RBAC legend.
  // Lane offset is a single global index across ALL arrows (not grouped by
  // source node) so two arrows that happen to share a "from" lane count
  // (e.g. web→acr and api→acr are both each other's "first" arrow) don't
  // collapse onto the same corridor row/badge position.
  const gapLaneCounters1 = {};
  for (const a of arrows) {
    const from = byId[a.from];
    const to = byId[a.to];
    const idx = arrows.indexOf(a);
    const laneOffset = (idx - (arrows.length - 1) / 2) * 15;
    const gapLane = (gapLaneCounters1[a.to] = (gapLaneCounters1[a.to] ?? -1) + 1);
    const { points: pts, labelSegment, labelT } = routeArrow(from, to, laneOffset, gapLane);
    const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
    out.push(`<path d="${d}" fill="none" stroke="${NEUTRAL_LINE}" stroke-width="1.75"${a.dashed ? ' stroke-dasharray="7 5"' : ""} marker-end="url(#arrow-neutral)"/>`);
    const [x1, y1] = pts[labelSegment];
    const [x2, y2] = pts[labelSegment + 1];
    const mx = x1 + (x2 - x1) * labelT;
    const my = y1 + (y2 - y1) * labelT;
    const [, badgeColor] = TONE_PALETTE[a.tone];
    out.push(`<circle cx="${mx}" cy="${my}" r="10" fill="${C.white}" stroke="${badgeColor}" stroke-width="1.75"/>`);
    out.push(`<text x="${mx}" y="${my + 4}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700" fill="${badgeColor}">${idx + 1}</text>`);
  }

  // RBAC / data-plane legend panel.
  out.push(`<rect x="${LEGEND.x}" y="${LEGEND.y}" width="${LEGEND.w}" height="${LEGEND.h}" fill="${C.grayLight}" stroke="${C.border}" stroke-width="1.5"/>`);
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
    out.push(`<text x="${lx + 26}" y="${ly}" font-family="Segoe UI, Arial, sans-serif" font-size="11.5" fill="${C.ink}">${esc(item.text.length > 58 ? item.text.slice(0, 57) + "\u2026" : item.text)}</text>`);
  });

  // WAF pillar summary panel.
  out.push(`<rect x="${PILLAR_BOX.x}" y="${PILLAR_BOX.y}" width="${PILLAR_BOX.w}" height="${PILLAR_BOX.h}" fill="${C.white}" stroke="${C.border}" stroke-width="1.5"/>`);
  out.push(`<text x="${PILLAR_BOX.x + 18}" y="${PILLAR_BOX.y + 28}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="${C.ink}">Well-Architected Framework pillars</text>`);
  PILLAR_SUMMARY.forEach((p, i) => {
    const py = PILLAR_BOX.y + 50 + i * 42;
    out.push(`<circle cx="${PILLAR_BOX.x + 24}" cy="${py}" r="6" fill="${PILLAR_COLOR[p.pillar]}"/>`);
    out.push(`<text x="${PILLAR_BOX.x + 40}" y="${py + 4}" font-family="Segoe UI, Arial, sans-serif" font-size="11.5" font-weight="700" fill="${C.ink}">${esc(p.pillar)}</text>`);
    const wrapped = wrapAt(p.text, 78);
    out.push(`<text x="${PILLAR_BOX.x + 18}" y="${py + 18}" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="${C.muted}">`);
    wrapped.forEach((line, li) => out.push(`<tspan x="${PILLAR_BOX.x + 18}" dy="${li === 0 ? 0 : 12}">${esc(line)}</tspan>`));
    out.push("</text>");
  });

  out.push(`<text x="36" y="${H - 16}" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="${C.muted}">Concept diagram \u2014 generic service names only, traced 1:1 to infra/main.bicep (same content as canada-life-idp-azure-production-topology.md). Dashed boxes/edges denote optional or conditional components. Official Microsoft Azure Architecture Center icons.</text>`);
  out.push("</svg>");
  fs.writeFileSync(svgOut, out.join("\n"));
  console.log(`Wrote ${svgOut}`);
}

function wrapAt(text, maxLen) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLen && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------
// .excalidraw (native, editable) renderer
// ---------------------------------------------------------------------------

let seedCounter = 1;
function nextSeed() {
  return 2000000 + seedCounter++;
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
      roundness: null,
    }),
  };
}

function textElement(id, x, y, w, h, text, size, color, weight, align) {
  return {
    id,
    type: "text",
    x, y, width: w, height: h,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 2,
    textAlign: align || "left",
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

  elements.push(textElement("doc-title", 36, 20, 1600, 32, "Canada Life IDP Platform", 24, C.ink, 700));
  elements.push(textElement("doc-subtitle", 36, 54, 1800, 20, "Azure architecture, organized against the Well-Architected Framework pillars", 13, C.muted, 400));

  // Boundaries: solid pastel fills, outer-to-inner.
  for (const b of boundaries) {
    const fill = b.id === "rg" ? C.rgFill : C.regionFill;
    const stroke = b.id === "rg" ? C.rgBorder : C.regionBorder;
    const rid = `bound-${b.id}`;
    elements.push(rectElement(rid, b.x, b.y, b.w, b.h, stroke, fill, false));
    elements.push(textElement(`${rid}-title`, b.x + 14, b.y + 8, b.w - 28, 20, b.title, 14, stroke, 700));
    if (b.subtitle) {
      elements.push(textElement(`${rid}-sub`, b.x + 14, b.y + 30, b.w - 28, 20, b.subtitle, 11.5, C.muted, 400));
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  // Nodes: pastel tint fill, icon centered on top, label centered below.
  for (const n of nodes) {
    const [fill, stroke] = TONE_PALETTE[n.tone];
    const rid = `node-${n.id}`;
    elements.push(rectElement(rid, n.x, n.y, n.w, n.h, stroke, fill, Boolean(n.dashed)));
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
    if (n.id === "entra") {
      elements.push(imageElement(`${rid}-icon`, n.x + 14, n.y + n.h / 2 - 16, 32, fileId));
      elements.push(textElement(`${rid}-title`, n.x + 60, n.y + n.h / 2 - 9, n.w - 70, 20, n.title, 13, C.ink, 600));
    } else {
      elements.push(imageElement(`${rid}-icon`, n.x + n.w / 2 - 18, n.y + 14, 36, fileId));
      const textTop = n.y + 58;
      elements.push(textElement(`${rid}-title`, n.x, textTop, n.w, n.h - (textTop - n.y), n.title, 13, C.ink, 600, "center"));
    }
  }

  // Connectors: neutral color + numbered badge (global lane index, see note
  // in renderSvg()'s matching loop).
  const gapLaneCounters2 = {};
  for (const a of arrows) {
    const from = byId[a.from];
    const to = byId[a.to];
    const idx = arrows.indexOf(a);
    const laneOffset = (idx - (arrows.length - 1) / 2) * 15;
    const gapLane = (gapLaneCounters2[a.to] = (gapLaneCounters2[a.to] ?? -1) + 1);
    const { points: pts, labelSegment, labelT } = routeArrow(from, to, laneOffset, gapLane);
    const id = `arrow-${a.from}-${a.to}-${idx}`;
    elements.push(arrowElement(id, pts, NEUTRAL_LINE, a.dashed));
    const [x1, y1] = pts[labelSegment];
    const [x2, y2] = pts[labelSegment + 1];
    const mx = x1 + (x2 - x1) * labelT;
    const my = y1 + (y2 - y1) * labelT;
    const [, badgeColor] = TONE_PALETTE[a.tone];
    elements.push(ellipseElement(`${id}-badge`, mx - 10, my - 10, 20, 20, badgeColor, C.white));
    elements.push(textElement(`${id}-badge-n`, mx - 10, my - 8, 20, 16, String(idx + 1), 11, badgeColor, 700, "center"));
  }

  // RBAC / data-plane legend panel.
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
    elements.push(textElement(`legend-${item.n}-n`, lx, ly + 1, 18, 14, String(item.n), 10, badgeColor, 700, "center"));
    elements.push(textElement(`legend-${item.n}-text`, lx + 24, ly, colW - 28, 18, item.text, 11.5, C.ink, 400));
  });

  // WAF pillar summary panel.
  elements.push(rectElement("pillar-box", PILLAR_BOX.x, PILLAR_BOX.y, PILLAR_BOX.w, PILLAR_BOX.h, C.border, C.white, false));
  elements.push(textElement("pillar-title", PILLAR_BOX.x + 18, PILLAR_BOX.y + 14, PILLAR_BOX.w - 36, 22, "Well-Architected Framework pillars", 15, C.ink, 700));
  PILLAR_SUMMARY.forEach((p, i) => {
    const py = PILLAR_BOX.y + 46 + i * 42;
    elements.push(ellipseElement(`pillar-dot-${i}`, PILLAR_BOX.x + 18, py, 12, 12, PILLAR_COLOR[p.pillar], PILLAR_COLOR[p.pillar]));
    elements.push(textElement(`pillar-name-${i}`, PILLAR_BOX.x + 36, py - 2, PILLAR_BOX.w - 50, 16, p.pillar, 11.5, C.ink, 700));
    elements.push(textElement(`pillar-text-${i}`, PILLAR_BOX.x + 18, py + 14, PILLAR_BOX.w - 32, 28, wrapAt(p.text, 78).join("\n"), 10, C.muted, 400));
  });

  elements.push(textElement("doc-footer", 36, H - 28, 2000, 18,
    "Concept diagram — generic service names only, traced 1:1 to infra/main.bicep (same content as canada-life-idp-azure-production-topology.md). Dashed boxes/edges denote optional or conditional components. Official Microsoft Azure Architecture Center icons.",
    12, C.muted, 400));

  const scene = {
    type: "excalidraw",
    version: 2,
    source: "https://github.com/ani1797/cl-idp docs/architecture/generate-azure-waf-architecture-diagram.mjs",
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
