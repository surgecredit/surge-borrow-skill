/**
 * E2E signer bridge. Lives in the test harness, never in the app's source tree.
 *
 * Node side (Playwright): `installBridge(page, identity)` exposes signing functions that run
 * against the harness wallet, then `adoptSigners(page)` hands the app proxy signers through
 * the flag-guarded `window.__surgeApp` handle. Private keys never enter the browser.
 */
import type { Page } from "@playwright/test";
import { getNetworkConfig, type Eip712TypedData, type TapInputRef } from "@surgecredit/borrow-sdk";
import type { Identity } from "./lib/wallet";

export interface BridgeControls {
  /** Make the next N wallet prompts of a kind throw an EIP-1193 4001 rejection (D13, G6, H6, J7, K4). */
  rejectNext(kind: "message" | "typedData" | "psbt", times?: number): void;
  /** Delay the next signature (SIGN_REQUEST_EXPIRED provocation, H6). */
  delayNext(kind: "message" | "typedData" | "psbt", ms: number): void;
  counts: { message: number; typedData: number; psbt: number };
  typedData: { primaryType: string; domain: Eip712TypedData["domain"] }[];
}

const reviveBigint = (json: string) => JSON.parse(json, (_k, v) => (v && typeof v === "object" && "__bigint" in v ? BigInt((v as { __bigint: string }).__bigint) : v)) as Eip712TypedData;

export async function installBridge(page: Page, identity: Identity): Promise<BridgeControls> {
  const rejects = { message: 0, typedData: 0, psbt: 0 };
  const delays = { message: 0, typedData: 0, psbt: 0 };
  const controls: BridgeControls = {
    rejectNext: (k, times = 1) => { rejects[k] += times; },
    delayNext: (k, ms) => { delays[k] = ms; },
    counts: { message: 0, typedData: 0, psbt: 0 },
    typedData: [],
  };
  const gate = async (k: keyof typeof rejects) => {
    controls.counts[k]++;
    if (delays[k]) { const ms = delays[k]; delays[k] = 0; await new Promise((r) => setTimeout(r, ms)); }
    if (rejects[k] > 0) { rejects[k]--; throw Object.assign(new Error("User rejected the request."), { code: 4001 }); }
  };
  await page.exposeFunction("__surgeE2E_signMessage", async (m: string) => { await gate("message"); return identity.evmSigner.signMessage(m); });
  await page.exposeFunction("__surgeE2E_signTypedData", async (json: string) => {
    await gate("typedData");
    const data = reviveBigint(json);
    controls.typedData.push({ primaryType: data.primaryType, domain: data.domain });
    return identity.evmSigner.signTypedData(data);
  });
  await page.exposeFunction("__surgeE2E_signPsbt", async (psbt: string, inputsJson: string) => { await gate("psbt"); return identity.btcSigner.signPsbt(psbt, JSON.parse(inputsJson) as TapInputRef[]); });
  // A real wallet stays connected across page loads; so does the bridge: on every navigation, adopt the
  // signers as soon as the app exposes its handle. A test may pre-set `window.__surgeE2E_chainId` (addInitScript)
  // to simulate a wallet on another chain (A2), or `__surgeE2E_noAuto` to opt out.
  const required = getNetworkConfig(identity.network).chainId;
  // Under tsx (scripts/e2e-drive.ts) esbuild wraps the named functions below in a `__name(...)` helper that does not
  // exist once the function is serialized into the page; Playwright's own loader does not. Define it so both work.
  await page.addInitScript({ content: "globalThis.__name = globalThis.__name || ((f) => f);" });
  await page.addInitScript(({ evmAddress, btcAddress, btcPublicKey, required }) => {
    const w = window as unknown as Record<string, unknown>;
    const start = Date.now();
    const tick = () => {
      if (w.__surgeE2E_noAuto) return;
      const app = w.__surgeApp as { setEvmWallet: (...a: unknown[]) => void; setBtcWallet: (...a: unknown[]) => void } | undefined;
      if (!app) { if (Date.now() - start < 60_000) setTimeout(tick, 100); return; }
      type Fn = (...a: string[]) => Promise<string>;
      const chainId = typeof w.__surgeE2E_chainId === "number" ? (w.__surgeE2E_chainId as number) : required;
      const signMessage = w.__surgeE2E_signMessage as Fn, signTypedData = w.__surgeE2E_signTypedData as Fn, signPsbt = w.__surgeE2E_signPsbt as Fn;
      const evmSigner = { address: evmAddress, signMessage: (m: string) => signMessage(m), signTypedData: (d: unknown) => signTypedData(JSON.stringify(d, (_k, x) => (typeof x === "bigint" ? { __bigint: x.toString() } : x))) };
      app.setEvmWallet({ status: "connected", address: evmAddress, chainId, label: "E2E test signer", source: "e2e" }, () => (chainId === required ? evmSigner : undefined));
      app.setBtcWallet({ status: "connected", address: btcAddress, publicKey: btcPublicKey, source: "e2e", label: "E2E test signer" }, { address: btcAddress, publicKey: btcPublicKey, signPsbt: (p: string, i: unknown) => signPsbt(p, JSON.stringify(i)) });
      w.__surgeE2E_adopted = true;
    };
    tick();
  }, { evmAddress: identity.evmAddress, btcAddress: identity.btcAddress, btcPublicKey: identity.btcXOnlyPubkey, required });
  return controls;
}

/** Runs in the page: builds proxy signers over the exposed functions and hands them to the app. */
export async function adoptSigners(page: Page, identity: Identity, opts: { chainId?: number } = {}) {
  const chainId = opts.chainId ?? getNetworkConfig(identity.network).chainId;
  const required = getNetworkConfig(identity.network).chainId;
  await page.waitForFunction(() => Boolean((window as unknown as { __surgeApp?: unknown }).__surgeApp));
  await page.evaluate(({ evmAddress, btcAddress, btcPublicKey, chainId, required }) => {
    type Fn = (...a: string[]) => Promise<string>;
    const w = window as unknown as Record<string, unknown>;
    const app = w.__surgeApp as { setEvmWallet: (...a: unknown[]) => void; setBtcWallet: (...a: unknown[]) => void };
    const signMessage = w.__surgeE2E_signMessage as Fn, signTypedData = w.__surgeE2E_signTypedData as Fn, signPsbt = w.__surgeE2E_signPsbt as Fn;
    const evmSigner = {
      address: evmAddress,
      signMessage: (m: string) => signMessage(m),
      signTypedData: (d: unknown) => signTypedData(JSON.stringify(d, (_k, x) => (typeof x === "bigint" ? { __bigint: x.toString() } : x))),
    };
    // Same chain gate as the real adapter: no signer unless the wallet chain matches (A2).
    app.setEvmWallet({ status: "connected", address: evmAddress, chainId, label: "E2E test signer", source: "e2e" }, () => (chainId === required ? evmSigner : undefined));
    app.setBtcWallet({ status: "connected", address: btcAddress, publicKey: btcPublicKey, source: "e2e", label: "E2E test signer" }, { address: btcAddress, publicKey: btcPublicKey, signPsbt: (p: string, i: unknown) => signPsbt(p, JSON.stringify(i)) });
  }, { evmAddress: identity.evmAddress, btcAddress: identity.btcAddress, btcPublicKey: identity.btcXOnlyPubkey, chainId, required });
}
