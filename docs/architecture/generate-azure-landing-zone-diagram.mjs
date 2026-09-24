import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.join(here, "assets", "azure-icons");
const output = path.join(here, "canada-life-idp-azure-landing-zone.svg");

const W = 3400;
const H = 2000;
const out = [];
const iconCache = new Map();

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

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function iconData(name) {
  if (!iconCache.has(name)) {
    const bytes = fs.readFileSync(path.join(iconDir, `${name}.svg`));
    iconCache.set(name, `data:image/svg+xml;base64,${bytes.toString("base64")}`);
  }
  return iconCache.get(name);
}

function rect(x, y, w, h, fill, stroke = C.border, sw = 2, rx = 14, dash = "") {
  out.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`
  );
}

function text(x, y, value, size = 20, color = C.ink, weight = 400, anchor = "start") {
  out.push(
    `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${esc(value)}</text>`
  );
}

function multiline(x, y, lines, size = 17, color = C.muted, weight = 400, gap = 1.3) {
  out.push(
    `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" fill="${color}" font-weight="${weight}">`
  );
  lines.forEach((value, index) => {
    out.push(`<tspan x="${x}" dy="${index === 0 ? 0 : size * gap}">${esc(value)}</tspan>`);
  });
  out.push("</text>");
}

function icon(x, y, name, size = 52) {
  out.push(`<image x="${x}" y="${y}" width="${size}" height="${size}" href="${iconData(name)}"/>`);
}

function boundary(x, y, w, h, title, subtitle, fill, stroke, iconName, dash = "") {
  rect(x, y, w, h, fill, stroke, 3, 18, dash);
  icon(x + 18, y + 16, iconName, 48);
  text(x + 78, y + 43, title, 25, stroke, 700);
  text(x + 78, y + 69, subtitle, 16, C.muted);
}

function service(x, y, w, title, iconName, lines, tone = "azure", h = 150) {
  const palettes = {
    azure: [C.azureLight, C.azure],
    teal: [C.tealLight, C.teal],
    maroon: [C.maroonLight, C.maroon],
    gold: [C.goldLight, C.gold],
    green: [C.greenLight, C.green],
    purple: [C.purpleLight, C.purple],
    gray: [C.grayLight, C.gray],
  };
  const [fill, stroke] = palettes[tone];
  rect(x, y, w, h, fill, stroke, 2, 12);
  icon(x + 14, y + 16, iconName, 52);
  text(x + 78, y + 40, title, 20, C.ink, 700);
  multiline(x + 78, y + 70, lines, 15, C.muted, 400, 1.35);
}

function compact(x, y, w, title, iconName, subtitle, tone = "azure") {
  const palettes = {
    azure: [C.azureLight, C.azure],
    teal: [C.tealLight, C.teal],
    maroon: [C.maroonLight, C.maroon],
    gold: [C.goldLight, C.gold],
    green: [C.greenLight, C.green],
    purple: [C.purpleLight, C.purple],
    gray: [C.grayLight, C.gray],
  };
  const [fill, stroke] = palettes[tone];
  rect(x, y, w, 92, fill, stroke, 2, 10);
  icon(x + 12, y + 18, iconName, 45);
  text(x + 66, y + 37, title, 17, C.ink, 700);
  text(x + 66, y + 63, subtitle, 13, C.muted);
}

function arrow(points, color = C.azure, dash = "") {
  out.push(
    `<polyline points="${points.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${color}" stroke-width="4"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#arrow-${color.slice(1)})"/>`
  );
}

function flowLabel(x, y, number, value, tone = C.azure) {
  rect(x, y, 30, 30, tone, tone, 1, 15);
  text(x + 15, y + 21, number, 15, C.white, 700, "middle");
  text(x + 40, y + 21, value, 15, C.ink, 700);
}

out.push('<?xml version="1.0" encoding="UTF-8"?>');
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">`);
out.push('<title id="title">Canada Life IDP simplified Azure service architecture</title>');
out.push('<desc id="desc">A simplified private Azure architecture showing how enterprise channels, internal ingress, AKS, Blob Storage, Service Bus, Azure AI Content Understanding, MongoDB Atlas, human review, output services, shared controls and Canadian disaster recovery work together.</desc>');
out.push(`
<defs>
  ${[C.azure, C.teal, C.gold, C.green, C.purple, C.maroon, C.gray].map((color) => `
  <marker id="arrow-${color.slice(1)}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,6 L9,3 z" fill="${color}"/>
  </marker>`).join("")}
</defs>`);
rect(0, 0, W, H, C.canvas, C.canvas, 0, 0);

text(38, 55, "Canada Life IDP — Simplified Azure Service Architecture", 32, C.maroon, 700);
text(38, 87, "Private enterprise platform • Canada East primary • Canada Central warm recovery • Shared by business unit", 17, C.muted);
rect(2860, 30, 220, 34, C.maroon, C.maroon, 1, 17);
text(2970, 53, "TARGET DESIGN", 15, C.white, 700, "middle");
rect(3100, 30, 245, 34, C.green, C.green, 1, 17);
text(3222, 53, "PRIVATE ACCESS ONLY", 15, C.white, 700, "middle");

boundary(30, 120, 3315, 165, "Enterprise governance and identity", "Controls apply consistently across every service and business-unit workload", C.white, C.maroon, "management-groups");
compact(80, 182, 500, "Microsoft Entra ID", "managed-identities", "SSO • MFA • Conditional Access • workload identity", "teal");
compact(615, 182, 500, "Landing-zone governance", "landing-zone", "Management groups • subscriptions • Azure Policy", "azure");
compact(1150, 182, 500, "Privileged access", "pim", "PIM • separation of duties • access reviews", "purple");
compact(1685, 182, 500, "Data and key controls", "key-vault", "CMK • retention • immutable evidence • legal hold", "gold");
compact(2220, 182, 500, "Security operations", "sentinel", "Defender • Sentinel • incident response", "maroon");
compact(2755, 182, 540, "Platform ownership", "resource-groups", "Central IT platform • scoped LOB roles and quotas", "gray");

boundary(30, 325, 650, 1000, "Private enterprise channels", "No internet-facing application endpoint", C.white, C.teal, "vnet");
boundary(720, 325, 2050, 1000, "Canada East — primary service platform", "Private endpoints and managed identities connect the services shown below", C.white, C.azure, "vnet");
boundary(2810, 325, 535, 1000, "Enterprise consumers", "Governed outputs and operations", C.white, C.green, "communication-services");

// Service-to-service paths are drawn before the cards so they terminate cleanly at card edges.
arrow([[630, 565], [790, 565]], C.teal);
arrow([[630, 815], [705, 815], [705, 855], [790, 855]], C.gold);
arrow([[1120, 565], [1170, 565]], C.azure);
arrow([[1500, 565], [1550, 565]], C.azure);
arrow([[1715, 640], [1715, 780]], C.purple);
arrow([[1600, 640], [1600, 710], [955, 710], [955, 780]], C.green);
arrow([[1120, 855], [1550, 855]], C.green);
arrow([[1880, 855], [1930, 855]], C.purple);
arrow([[2260, 855], [2310, 855]], C.purple);
arrow([[2475, 930], [2475, 1080]], C.green);
arrow([[2310, 1155], [2280, 1155], [2280, 1030], [1715, 1030], [1715, 1080]], C.green);
arrow([[1880, 1155], [1930, 1155]], C.green);
arrow([[2260, 1155], [2280, 1155], [2280, 1270], [2810, 1270], [2810, 1155], [2870, 1155]], C.green);

flowLabel(690, 530, "1", "Private intake", C.teal);
flowLabel(1130, 530, "2", "API policy", C.azure);
flowLabel(1485, 735, "3", "Persist and queue", C.purple);
flowLabel(1885, 820, "4", "Process", C.purple);
flowLabel(2270, 820, "5", "Extract", C.purple);
flowLabel(1250, 1050, "6", "Review or release", C.green);

service(70, 470, 560, "Employees, reviewers and internal apps", "managed-identities", [
  "Managed endpoints and approved workloads",
  "Canada Life WAN or private Azure connectivity",
  "Entra user or service identity",
], "teal", 190);
service(70, 720, 560, "Batch, mailbox and event channels", "event-grid", [
  "Enterprise MFT/SFTP and governed Blob drops",
  "Shared mailbox and internal event integration",
  "Validated tenant, process and correlation metadata",
], "gold", 190);
service(70, 970, 560, "Private connectivity requirement", "expressroute", [
  "Dual ExpressRoute paths with VPN fallback",
  "Enterprise DNS resolves private service endpoints",
  "No direct internet path to the application",
], "gray", 190);

service(790, 490, 330, "Application Gateway", "application-gateway", [
  "Private frontend only",
  "Internal TLS termination and health probes",
  "Routes UI and API traffic",
], "teal");
service(1170, 490, 330, "API Management", "apim", [
  "OAuth/JWT and mTLS policy",
  "Schema validation • quotas • rate limits",
  "Internal API products by business unit",
], "gold");
service(1550, 490, 330, "AKS web and API", "aks", [
  "Next.js console and FastAPI control plane",
  "Process, model, job and review APIs",
  "Private, zone-aware and autoscaled",
], "azure");

service(790, 780, 330, "Blob Storage", "storage", [
  "Quarantine, clean, evidence and exchange",
  "Malware/DLP release and lifecycle controls",
  "Immutable evidence where required",
], "green");
service(1550, 780, 330, "Service Bus Premium", "service-bus", [
  "Durable intake and work queues",
  "PeekLock • retries • DLQ • idempotency",
  "Topics deliver completion events",
], "purple");
service(1930, 780, 330, "AKS worker pool", "aks", [
  "Consumes queued document work",
  "Loads clean content and invokes analyzers",
  "Scales on queue depth and message age",
], "green");
service(2310, 780, 330, "AI Content Understanding", "ai-foundry", [
  "Routes to prebuilt or custom analyzers",
  "Returns fields, confidence and evidence",
  "Canadian availability remains a launch gate",
], "maroon");

service(1550, 1080, 330, "Native review workflow", "aks", [
  "Low-confidence items enter review queues",
  "Reviewer sees source, evidence and fields",
  "Decisions and corrections are attributed",
], "azure");
service(1930, 1080, 330, "Approved output services", "communication-services", [
  "Internal APIs, topics, events and batch exchange",
  "Canonical results and correlation IDs",
  "Delivery acknowledgements support reconciliation",
], "green");
service(2310, 1080, 330, "MongoDB Atlas", "cosmos-db", [
  "Process, job, extraction and review state",
  "Tenant-aware collections, indexing and versioning",
  "Continuous backup and Canadian-region replica set",
], "azure");

service(2870, 1040, 415, "Claims and business platforms", "communication-services", [
  "Claims and case management",
  "Policy, records, fraud/risk and analytics",
  "Consume approved canonical outputs",
], "green", 210);
service(2870, 700, 415, "Platform and security teams", "monitor", [
  "SRE dashboards, alerts and runbooks",
  "Security investigation and evidence",
  "Model and process governance",
], "purple", 210);

boundary(30, 1360, 3315, 210, "Shared platform services", "These capabilities secure, deliver and operate the full document-processing path", C.purpleLight, C.purple, "resource-groups");
compact(80, 1440, 480, "Private Link and DNS", "private-endpoint", "Private endpoints • Atlas PrivateLink • resolver • Firewall routes", "teal");
compact(595, 1440, 480, "Secrets and identities", "key-vault", "Key Vault • managed identities • CMK", "gold");
compact(1110, 1440, 480, "Software supply chain", "acr", "ACR • signed images • SBOM • GitOps", "azure");
compact(1625, 1440, 480, "Observability", "monitor", "Azure Monitor • App Insights • Grafana", "purple");
compact(2140, 1440, 480, "Threat protection", "defender-cloud", "Defender • Sentinel • immutable audit", "maroon");
compact(2655, 1440, 640, "Automation and governance", "automation", "Bicep • policy-as-code • budgets • failover runbooks", "gray");

boundary(30, 1600, 3315, 330, "Canada Central — warm recovery platform", "Scaled-down private regional stamp; Canadian data replication and quarterly recovery exercises support RTO 4h / RPO 15m planning targets", C.goldLight, C.gold, "vnet", "12 8");
compact(80, 1710, 480, "Private regional ingress", "application-gateway", "Application Gateway + internal APIM", "gold");
compact(595, 1710, 480, "Warm AKS stamp", "aks", "System services online • workloads scale by runbook", "azure");
compact(1110, 1710, 480, "Messaging recovery", "service-bus", "Premium replication • DLQ and replay controls", "purple");
compact(1625, 1710, 480, "Data replicas", "cosmos-db", "Atlas replica set failover • Blob geo-protection", "green");
compact(2140, 1710, 480, "Artifact and key recovery", "acr", "ACR replica • tested key recovery pattern", "azure");
compact(2655, 1710, 640, "Controlled promotion", "automation", "Promote data → scale AKS → shift private DNS/routes → reconcile", "maroon");

text(35, 1975, "Official Microsoft Azure Architecture Center icons. CIDRs, SKUs, quotas and the AI regional launch gate remain implementation decisions documented in the companion architecture specification.", 14, C.muted);

out.push("</svg>");
fs.writeFileSync(output, out.join("\n"));
console.log(`Wrote ${output}`);
