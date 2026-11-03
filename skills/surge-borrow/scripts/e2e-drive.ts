/**
 * Extension-free UI session on live signet: a real browser window, signed by a harness identity.
 *
 *   tsx scripts/e2e-drive.ts drive [--identity N] [--auto] [--url http://localhost:3000] [--reserve 2,3]
 *       Opens the app in a headed Chromium with identity N's signers bridged in. Every signature the app asks for is
 *       confirmed here in the terminal first (Enter = sign, n = reject), so the terminal plays the wallet. --auto
 *       signs without asking. Defaults to the next unused identity; 0 (funding) and 1 (parked) are always refused,
 *       --reserve adds the indices your lifecycles own. Starts the dev server itself (NEXT_PUBLIC_E2E=1 and a
 *       non-throttling RPC) when the port is free and stops it on exit; a server already on the port is reused only
 *       if it exposes the app's test handle, otherwise the command stops at once and names that server. The RPC the
 *       page reads through is written to the app's endpoint override in localStorage before any script runs.
 *   tsx scripts/e2e-drive.ts drive --check [--identity N] [--url …]
 *       Headless: proves the bridge adopts into the app and writes .e2e/drive-check.png, then exits.
 *   tsx scripts/e2e-drive.ts pay <address> <sats> [--fee N] [--no-wait] [--yes]
 *       Sends signet BTC from identity 0 (the funding wallet) to a vault or any tb1 address and waits for 1 confirmation.
 *
 * Adapt three things to the app you are driving: DEV_SERVER (how its dev server starts), the handle check (the window
 * property the app exposes in test builds; see bridge.ts) and OVERRIDE_KEY (where the app stores its endpoint
 * override). Keys never leave this process; the page receives proxy signers over Playwright's exposeFunction. A
 * production build must fail its bundle check if the handle is reachable.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createBorrowClient, deriveVaultAddress, getNetworkConfig, type Network } from "@surgecredit/borrow-sdk";
import { installBridge } from "./bridge";
import { deriveIdentity, E2E_DIR, loadOrCreateWallet, readLedger, upsertIdentity, writeLedger, type Identity } from "./lib/wallet";
import { Esplora } from "./lib/esplora";
import { sendFromIdentity } from "./lib/funding";

/** How the app's dev server starts on a given port; the test flag and the RPC override go in its environment. */
const DEV_SERVER = (port: number) => ({ cmd: "pnpm", args: ["exec", "next", "dev", "-p", String(port)] });
/** localStorage key of the app's per-network endpoint override (the Settings screen's store). */
const OVERRIDE_KEY = (network: Network) => `surge.settings.endpoints.${network}`;
/** Identities no manual session may use: the funding wallet and the parked position, plus --reserve. */
const ALWAYS_RESERVED: Record<number, string> = { 0: "the funding wallet", 1: "the parked position (never touch before its deadline)" };

export interface DriveDeps { mnemonic: string; fingerprint: string; network: Network; evmRpcUrl: string; btcApiUrl: string }

/** The next index the ledger has never used and nothing reserves. */
export function nextFreeIdentity(network: Network, reserved: Record<number, string>): number {
  const ledger = readLedger();
  const used = new Set(Object.values(ledger.identities).filter((e) => e.network === network).map((e) => e.index));
  for (let i = 0; i < 2 ** 31; i++) if (!used.has(i) && !(i in reserved)) return i;
  throw new Error("no free identity index");
}

async function isUp(url: string): Promise<boolean> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; }
}

/** Who listens on the port (for the message when that server cannot be used). */
function listener(port: number): string {
  const pid = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
  if (!pid) return "an unknown process";
  const cmd = spawnSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).stdout.trim();
  return `pid ${pid}${cmd ? ` (${cmd.slice(0, 80)})` : ""}`;
}

function startDevServer(port: number, evmRpcUrl: string): ChildProcess {
  console.log(`[drive] nothing listens on port ${port}; starting the dev server with NEXT_PUBLIC_E2E=1`);
  const { cmd, args } = DEV_SERVER(port);
  const child = spawn(cmd, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_PUBLIC_E2E: "1", NEXT_PUBLIC_SIGNET_EVM_RPC_URL: process.env.NEXT_PUBLIC_SIGNET_EVM_RPC_URL || evmRpcUrl } });
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[dev] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[dev] ${d}`));
  return child;
}

function stopDevServer(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

/** Terminal confirmation for one signature. Resolves true to sign, false to reject (EIP-1193 4001 in the page). */
function confirmInTerminal(rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  return new Promise((resolve) => rl.question(`${question} [Enter = sign, n = reject] `, (a) => resolve(!/^n/i.test(a.trim()))));
}

/** Wrap the identity's signers so each request is announced (and, unless --auto, confirmed) in the terminal. Payloads and signatures are never printed. */
function terminalWallet(identity: Identity, auto: boolean): Identity {
  const rl = auto ? null : createInterface({ input: process.stdin, output: process.stdout });
  const gate = async (what: string) => {
    if (!rl) { console.log(`[wallet] signing: ${what}`); return; }
    const ok = await confirmInTerminal(rl, `[wallet] ${what}?`);
    if (!ok) { console.log("[wallet] rejected"); throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }
    console.log("[wallet] signed");
  };
  return {
    ...identity,
    evmSigner: {
      address: identity.evmSigner.address,
      signMessage: async (m) => { await gate(/Sign in with Ethereum|wants you to sign in/i.test(m) ? "EVM · Sign-In with Ethereum message" : "EVM · EIP-191 envelope (hands a signed request to Surge)"); return identity.evmSigner.signMessage(m); },
      signTypedData: async (d) => { await gate(`EVM · EIP-712 ${d.primaryType} (domain ${d.domain?.name ?? "?"})`); return identity.evmSigner.signTypedData(d); },
    },
    btcSigner: {
      address: identity.btcSigner.address,
      publicKey: identity.btcSigner.publicKey,
      signPsbt: async (psbt, inputs) => { await gate(`Bitcoin · Schnorr signature over ${inputs.length} vault input${inputs.length === 1 ? "" : "s"}`); return identity.btcSigner.signPsbt(psbt, inputs); },
    },
  };
}

/** Page noise policy: script errors are printed; throttled requests are counted and summarised every 10 s instead of echoed one by one. */
function watchPage(page: Page) {
  const throttled = new Map<string, number>();
  let timer: NodeJS.Timeout | null = null;
  page.on("pageerror", (e) => console.log(`[browser error] ${e.message.slice(0, 300)}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log(`[browser error] ${m.text().slice(0, 300)}`); });
  page.on("response", (r) => {
    if (r.status() !== 429) return;
    const host = new URL(r.url()).host;
    throttled.set(host, (throttled.get(host) ?? 0) + 1);
    timer ??= setTimeout(() => {
      timer = null;
      for (const [h, n] of throttled) console.log(`[browser] ${n} request${n === 1 ? "" : "s"} throttled (429) by ${h} in the last 10 s; the app retries with backoff. If it keeps happening, pick another endpoint in Settings.`);
      throttled.clear();
    }, 10_000);
  });
}

export async function drive(deps: DriveDeps, opts: { index?: number; url: string; auto: boolean; check: boolean; reserved?: Record<number, string> }) {
  const reserved = { ...ALWAYS_RESERVED, ...(opts.reserved ?? {}) };
  const index = opts.index ?? nextFreeIdentity(deps.network, reserved);
  if (index in reserved && !opts.check) throw new Error(`identity ${index} is ${reserved[index]}; pick another with --identity`);
  const raw = deriveIdentity(deps.mnemonic, index, deps.network);
  const identity = opts.check ? raw : terminalWallet(raw, opts.auto);
  const vault = deriveVaultAddress({ userBtcPublicKey: raw.btcXOnlyPubkey, evmAddress: raw.evmAddress, network: deps.network }).address;
  const port = Number(new URL(opts.url).port || 80);
  if (!opts.check) {
    const ledger = readLedger();
    upsertIdentity(ledger, raw, "manual drive (UI session)", deps.fingerprint);
    writeLedger(ledger);
  }

  // Whatever ends this process, a dev server we spawned goes with it.
  let dev: ChildProcess | null = null;
  process.on("exit", () => stopDevServer(dev));
  const reused = await isUp(opts.url);
  if (!reused) {
    dev = startDevServer(port, deps.evmRpcUrl);
    const started = Date.now();
    while (!(await isUp(opts.url))) {
      if (dev.exitCode !== null) throw new Error(`the dev server exited with code ${dev.exitCode} before listening (see the [dev] lines above; Next refuses a second instance of a project while another dev server of it runs)`);
      if (Date.now() - started > 120_000) throw new Error("dev server did not come up within 120 s");
      await new Promise((r) => setTimeout(r, 1000));
    }
  } else console.log(`[drive] reusing the server on port ${port} (${listener(port)})`);

  const browser = await chromium.launch({ headless: opts.check, args: opts.check ? [] : ["--window-size=460,900"] });
  try {
    const context = await browser.newContext({ viewport: opts.check ? { width: 390, height: 844 } : null });
    const page = await context.newPage();
    watchPage(page);
    // The app's endpoint override, written before any page script runs: the page reads through a non-throttling RPC
    // whichever way the server was started.
    const override = JSON.stringify({ evmRpcUrl: deps.evmRpcUrl, btcApiUrl: process.env.SIGNET_BTC_API_URL || undefined });
    await page.addInitScript({ content: `try { localStorage.setItem(${JSON.stringify(OVERRIDE_KEY(deps.network))}, ${JSON.stringify(override)}); } catch {}` });
    await installBridge(page, identity);
    await page.goto(opts.url);
    const handle = await page.waitForFunction(() => typeof (window as unknown as { __surgeApp?: unknown }).__surgeApp === "object", null, { timeout: reused ? 20_000 : 60_000 }).then(() => true).catch(() => false);
    if (!handle) {
      throw new Error([
        `the app on port ${port} has no signer injection point, so this server was started without NEXT_PUBLIC_E2E=1 (${listener(port)}).`,
        "Either stop that server and run the drive command again, which starts its own, or restart it as:",
        `  NEXT_PUBLIC_E2E=1 NEXT_PUBLIC_SIGNET_EVM_RPC_URL=${deps.evmRpcUrl} <your dev command>`,
      ].join("\n"));
    }
    const adopted = await page.waitForFunction(() => (window as unknown as { __surgeE2E_adopted?: boolean }).__surgeE2E_adopted === true, null, { timeout: 20_000 }).then(() => true).catch(() => false);
    if (!adopted) {
      const probe = await page.evaluate(() => { const w = window as unknown as Record<string, unknown>; return { handle: typeof w.__surgeApp, bridge: typeof w.__surgeE2E_signMessage, adopted: w.__surgeE2E_adopted, text: document.body.innerText.slice(0, 160).replace(/\s+/g, " ") }; }).catch((e: Error) => ({ error: e.message }));
      throw new Error(`the signer bridge did not adopt into the app (page state ${JSON.stringify(probe)}); see bridge.ts`);
    }
    if (opts.check) {
      const file = join(E2E_DIR, "drive-check.png");
      await page.getByTestId("evm-address").waitFor({ timeout: 30_000 });
      const endpoints = await page.evaluate((k) => localStorage.getItem(k), OVERRIDE_KEY(deps.network));
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[drive] bridge adopted for identity ${index} (EVM ${raw.evmAddress}, BTC ${raw.btcAddress}); endpoints override ${endpoints}; screenshot ${file}`);
      return;
    }
    console.log([
      "",
      `Driving ${opts.url} as identity ${index} (signers bridged from the harness wallet; keys stay in this process)`,
      `  EVM   ${raw.evmAddress}   Base Sepolia; borrowed USDC lands here, repayment USDC must be here`,
      `  BTC   ${raw.btcAddress}   signet key the vault is derived from (not a funding address)`,
      `  vault ${vault}   where collateral goes once the Open screen has created a deposit`,
      `  RPC   ${deps.evmRpcUrl} (set as the app's endpoint override for this window)`,
      "",
      "Sign in from the Connect screen. When the Open screen shows the deposit address and amount, fund it with",
      `  tsx scripts/e2e-drive.ts pay ${vault} <sats>        (from identity 0, the funding wallet; ~1 min to confirm, 3 confirmations to mint)`,
      "or send the sats from SurgeSats (https://wallet.surge.dev). Withdrawals can go back to identity 0:",
      `  ${deriveIdentity(deps.mnemonic, 0, deps.network).btcAddress}`,
      opts.auto ? "Signatures are given automatically (--auto)." : "Each signature is confirmed here before it is given; answer n to see the rejected-prompt states.",
      "Close the browser window or press Ctrl-C to stop.",
      "",
    ].join("\n"));
    await new Promise<void>((resolve) => {
      browser.on("disconnected", () => resolve());
      const onSignal = () => { stopDevServer(dev); dev = null; resolve(); };
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    });
  } finally {
    stopDevServer(dev);
    dev = null;
    await browser.close().catch(() => undefined);
  }
  process.exit(0);
}

export async function pay(deps: DriveDeps, p: { to: string; sats: bigint; feeRate?: number; wait: boolean; yes: boolean }) {
  const funding = deriveIdentity(deps.mnemonic, 0, deps.network);
  const prefix = deps.network === "mainnet" ? "bc1" : "tb1";
  if (!p.to.startsWith(prefix)) throw new Error(`destination must be a ${prefix}… address on ${deps.network}`);
  if (p.to === funding.btcAddress) throw new Error("that is the funding wallet itself");
  if (p.sats > 1_000_000n && !p.yes) throw new Error(`${p.sats} sats is more than any test step needs; add --yes if you mean it`);
  const esplora = new Esplora(deps.btcApiUrl);
  const client = createBorrowClient({ network: deps.network, evmRpcUrl: deps.evmRpcUrl, btcApiUrl: deps.btcApiUrl });
  const fees = await client.getFeeRates();
  const feeRate = p.feeRate ?? Math.max(1, fees.medium);
  const r = await sendFromIdentity({ from: funding, toAddress: p.to, amountSats: p.sats, feeRate, esplora, network: deps.network });
  const explorer = deps.network === "mainnet" ? `https://mempool.space/tx/${r.txid}` : `https://signet.surge.dev/tx/${r.txid}`;
  console.log(`[pay] ${p.sats} sats → ${p.to}\n[pay] txid ${r.txid} (fee ${r.feeSats} sats at ${feeRate} sat/vB, ${r.inputs} input${r.inputs === 1 ? "" : "s"})\n[pay] ${explorer}`);
  const ledger = readLedger();
  const entry = upsertIdentity(ledger, funding, "funding wallet", deps.fingerprint);
  (entry.notes ??= []).push(`${new Date().toISOString()} pay ${p.sats} sats → ${p.to} txid ${r.txid}`);
  writeLedger(ledger);
  if (p.wait) {
    const confs = await esplora.waitForConfirmations(r.txid, 1, { intervalMs: 10_000, timeoutMs: 20 * 60_000, onTick: (c) => console.log(`[pay] ${c} confirmation${c === 1 ? "" : "s"}`) });
    console.log(`[pay] confirmed (${confs}); a deposit mints after 3, a collateral sync after 3`);
  }
}

/* ---- command line ---- */
const arg = (f: string, d?: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const has = (f: string) => process.argv.includes(f);

async function main() {
  const network: Network = "signet";
  const wallet = loadOrCreateWallet(network);
  const cfg = getNetworkConfig(network);
  const deps: DriveDeps = {
    mnemonic: wallet.mnemonic,
    fingerprint: wallet.fingerprint,
    network,
    // The SDK default throttles the browser's read bursts; publicnode did not in testing.
    evmRpcUrl: process.env.SIGNET_EVM_RPC_URL ?? "https://base-sepolia-rpc.publicnode.com",
    btcApiUrl: process.env.SIGNET_BTC_API_URL ?? cfg.btcApiUrl,
  };
  const cmd = process.argv[2];
  if (cmd === "drive") {
    const reserved = Object.fromEntries((arg("--reserve") ?? "").split(",").filter(Boolean).map((n) => [Number(n), "a lifecycle identity (--reserve)"]));
    await drive(deps, { index: arg("--identity") !== undefined ? Number(arg("--identity")) : undefined, url: arg("--url", "http://localhost:3000")!, auto: has("--auto"), check: has("--check"), reserved });
    return;
  }
  if (cmd === "pay") {
    const [to, sats] = [process.argv[3], process.argv[4]];
    if (!to || !sats || !/^\d+$/.test(sats)) throw new Error("usage: tsx scripts/e2e-drive.ts pay <tb1… address> <sats> [--fee N] [--no-wait] [--yes]");
    await pay(deps, { to, sats: BigInt(sats), feeRate: arg("--fee") ? Number(arg("--fee")) : undefined, wait: !has("--no-wait"), yes: has("--yes") });
    return;
  }
  console.log("usage: tsx scripts/e2e-drive.ts drive [--identity N] [--auto] [--check] [--url http://localhost:3000] [--reserve 2,3] | pay <address> <sats> [--fee N] [--no-wait] [--yes]");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
