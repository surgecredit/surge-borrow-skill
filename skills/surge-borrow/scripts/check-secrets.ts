/**
 * Secret scanner over tracked files and (if present) the built bundle. Pass the bundle directory as the first
 * argument or in BUNDLE_DIR (default .next/static, Next.js); run it after the production build.
 * Fails on JWTs, long hex signatures/private keys, PSBTs, extended private keys, PEM blocks,
 * Supabase secret keys, and anything that looks like a 12/24-word BIP-39 phrase.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { wordlists } from "bip39";
import { getNetworkConfig } from "@surgecredit/borrow-sdk";

/** The SDK embeds Supabase ANON keys, which are JWT-shaped but public client keys by design (index.d.ts NetworkConfig). */
const PUBLIC_JWTS = new Set([getNetworkConfig("signet").supabaseAnonKey, getNetworkConfig("mainnet").supabaseAnonKey]);

const english = new Set(wordlists.english);
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const patterns: [RegExp, string][] = [
  [/\b(xprv|tprv|vprv)[1-9A-HJ-NP-Za-km-z]{90,}/, "extended private key"],
  [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, "PEM private key"],
  [/\bcHNidP8[A-Za-z0-9+/=]{40,}/, "PSBT (base64)"],
  [/\b70736274ff[0-9a-f]{40,}/i, "PSBT (hex)"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/\b0x[0-9a-fA-F]{130}\b/, "65-byte signature"],
  [/(private[_-]?key|PRIVATE_KEY)\s*[:=]\s*["']?(0x)?[0-9a-fA-F]{64}/, "private key assignment"],
];

function looksLikeMnemonic(line: string): boolean {
  const words = line.toLowerCase().match(/[a-z]+/g) ?? [];
  let run = 0;
  for (const w of words) {
    run = english.has(w) ? run + 1 : 0;
    if (run >= 12) return true;
  }
  return false;
}

const tracked = execSync("git ls-files -z", { encoding: "utf8" }).split("\0").filter(Boolean);
const allow = new Set(["pnpm-lock.yaml"]);
const sourceFiles = tracked.filter((f) => !allow.has(f) && existsSync(f) && statSync(f).isFile());
const bundleFiles: string[] = [];
const bundleDir = process.argv[2] ?? process.env.BUNDLE_DIR ?? ".next/static";
if (existsSync(bundleDir)) {
  const walk = (d: string, out: string[] = []): string[] => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
  bundleFiles.push(...walk(bundleDir).filter((f) => /\.(js|mjs|json)$/.test(f)));
}

const findings: string[] = [];
function scan(f: string, bundle: boolean) {
  let s: string;
  try { s = readFileSync(f, "utf8"); } catch { return; }
  if (/\0/.test(s.slice(0, 1000))) return; // binary
  const lines = s.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(JWT_RE)) if (!PUBLIC_JWTS.has(m[0])) findings.push(`${f}:${i + 1}: JWT`);
    for (const [re, what] of patterns) {
      // Minified crypto libraries legitimately contain 65-byte hex constants; only source files get that heuristic.
      if (bundle && what === "65-byte signature") continue;
      if (re.test(line)) findings.push(`${f}:${i + 1}: ${what}`);
    }
    // Mnemonic heuristic for source only: bundles embed @scure/bip39's wordlist, docs may list words deliberately.
    if (!bundle && !/node_modules|wordlist/.test(f) && !f.endsWith(".md") && looksLikeMnemonic(line)) findings.push(`${f}:${i + 1}: 12+ consecutive BIP-39 words`);
  });
}
for (const f of sourceFiles) scan(f, false);
for (const f of bundleFiles) scan(f, true);
const files = [...sourceFiles, ...bundleFiles];
if (tracked.some((f) => f.startsWith(".e2e/") || (/^\.env(\.|$)/.test(f) && f !== ".env.example"))) findings.push("a .e2e/ or .env file is tracked by git");

if (findings.length) {
  console.error("check-secrets FAILED:\n - " + findings.join("\n - "));
  process.exit(1);
}
console.log(`check-secrets OK (${files.length} files scanned)`);
