/**
 * Test-wallet management for the E2E harness (docs/BRIEF.md §7).
 *
 * SECURITY: this module is imported only by code under scripts/ and tests/.
 * A build-time check (scripts/check-bundle.ts) fails the production bundle if
 * anything under src/ reaches it. It prints derived addresses, never the phrase.
 *
 *  - .e2e/wallet.json           signet harness wallet (mode 0600)
 *  - .e2e/wallet.mainnet.json   mainnet paid-run wallet (separate, same shape)
 *  - .e2e/identities.json       ledger of which identity index did what
 *
 * Identity N (one per full lifecycle, see §3.7):
 *   EVM  m/44'/60'/N'/0/0
 *   BTC  m/86'/1'/N'/0/0 on signet   |   m/86'/0'/N'/0/0 on mainnet
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import * as bitcoin from "bitcoinjs-lib";
import { crypto as bcrypto } from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from "bip39";
import { mnemonicToAccount } from "viem/accounts";
import type { BtcSigner, Eip712TypedData, EvmSigner, Network, TapInputRef } from "@surgecredit/borrow-sdk";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

/** Marker: scripts/check-bundle.ts fails any production chunk containing it. */
export const HARNESS_WALLET_MARKER = "SURGE_HARNESS_WALLET_DO_NOT_BUNDLE";
export const E2E_DIR = join(process.cwd(), ".e2e");
export const walletFile = (network: Network) =>
  join(E2E_DIR, network === "mainnet" ? "wallet.mainnet.json" : "wallet.json");
export const LEDGER_FILE = join(E2E_DIR, "identities.json");

interface WalletFile {
  version: 1;
  network: Network;
  source: "generated" | "env";
  /** Present only when the harness generated the phrase itself. */
  mnemonic?: string;
  /** sha256(phrase) first 16 hex chars — enough to recognise a wallet, useless to recover it. */
  fingerprint: string;
  createdAt: string;
}

export const fingerprintOf = (mnemonic: string) =>
  createHash("sha256").update(mnemonic.trim().normalize("NFKD")).digest("hex").slice(0, 16);

function ensureDir() {
  if (!existsSync(E2E_DIR)) mkdirSync(E2E_DIR, { mode: 0o700 });
  chmodSync(E2E_DIR, 0o700);
}

function writeSecret(file: string, data: unknown) {
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}

/**
 * Load the harness wallet for `network`, generating it on first run.
 * TEST_MNEMONIC (or TEST_MNEMONIC_MAINNET) overrides and is never written to disk.
 * Returns the phrase in memory only; callers must not log it.
 */
export function loadOrCreateWallet(network: Network): { mnemonic: string; fingerprint: string; source: "generated" | "env"; file: string; created: boolean } {
  ensureDir();
  const file = walletFile(network);
  const envName = network === "mainnet" ? "TEST_MNEMONIC_MAINNET" : "TEST_MNEMONIC";
  const fromEnv = process.env[envName]?.trim();

  if (fromEnv) {
    if (!validateMnemonic(fromEnv)) throw new Error(`${envName} is not a valid BIP-39 mnemonic (checksum failed).`);
    const fp = fingerprintOf(fromEnv);
    const existing = readWalletFile(file);
    if (!existing || existing.fingerprint !== fp || existing.source !== "env") {
      const rec: WalletFile = { version: 1, network, source: "env", fingerprint: fp, createdAt: new Date().toISOString() };
      writeSecret(file, rec);
    }
    return { mnemonic: fromEnv, fingerprint: fp, source: "env", file, created: false };
  }

  const existing = readWalletFile(file);
  if (existing) {
    if (existing.source === "env") {
      throw new Error(
        `${file} records an operator-supplied wallet (fingerprint ${existing.fingerprint}) but ${envName} is not set. Export it again, or delete the file to generate a fresh wallet (any coins on the old identities stay with the old phrase).`,
      );
    }
    if (!existing.mnemonic || !validateMnemonic(existing.mnemonic)) throw new Error(`${file} is corrupt; refusing to continue.`);
    return { mnemonic: existing.mnemonic, fingerprint: existing.fingerprint, source: "generated", file, created: false };
  }

  // 256 bits of entropy from the OS CSPRNG -> 24 words.
  const mnemonic = entropyToMnemonic(randomBytes(32).toString("hex"));
  const rec: WalletFile = { version: 1, network, source: "generated", mnemonic, fingerprint: fingerprintOf(mnemonic), createdAt: new Date().toISOString() };
  writeSecret(file, rec);
  return { mnemonic, fingerprint: rec.fingerprint, source: "generated", file, created: true };
}

function readWalletFile(file: string): WalletFile | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as WalletFile;
}

export interface Identity {
  index: number;
  network: Network;
  evmAddress: `0x${string}`;
  btcAddress: string;
  /** x-only (32-byte) hex, what the vault is derived from. */
  btcXOnlyPubkey: string;
  evmPath: string;
  btcPath: string;
  evmSigner: EvmSigner;
  btcSigner: BtcSigner;
  /** Key-path signing of the identity's OWN P2TR UTXOs (funding transactions), not vault spends. */
  signOwnKeyPath: (psbt: bitcoin.Psbt) => void;
}

const LEAF_VERSION = 0xc0;
function tapleafHash(script: Buffer): Buffer {
  const ver = Buffer.from([LEAF_VERSION]);
  const len = Buffer.from([script.length]);
  return Buffer.from(bcrypto.taggedHash("TapLeaf", Buffer.concat([ver, len, script])));
}
const toXOnly = (pub: Uint8Array): Buffer => Buffer.from(pub).subarray(1, 33);

/** Derive identity `index` from the phrase. Mirrors examples/playground/signers/mnemonic.ts with an account index. */
export function deriveIdentity(mnemonic: string, index: number, network: Network): Identity {
  if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error(`identity index must be a non-negative integer below 2^31, got ${index}`);
  const phrase = mnemonic.trim();

  const evmPath = `m/44'/60'/${index}'/0/0`;
  const account = mnemonicToAccount(phrase, { accountIndex: index, changeIndex: 0, addressIndex: 0 });
  const evmSigner: EvmSigner = {
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    signTypedData: (data: Eip712TypedData) => account.signTypedData(data as never),
  };

  const btcNet = network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const btcPath = network === "mainnet" ? `m/86'/0'/${index}'/0/0` : `m/86'/1'/${index}'/0/0`;
  const root = bip32.fromSeed(mnemonicToSeedSync(phrase), btcNet);
  const child = root.derivePath(btcPath);
  const xOnly = toXOnly(child.publicKey);
  const { address } = bitcoin.payments.p2tr({ internalPubkey: xOnly, network: btcNet });
  if (!address) throw new Error("p2tr derivation returned no address");
  const priv = Buffer.from(child.privateKey!);

  const btcSigner: BtcSigner = {
    address,
    publicKey: xOnly.toString("hex"),
    // Script-path Schnorr sign each repayment-leaf input (vault spends: withdraw / extend).
    signPsbt: async (psbtBase64: string, inputs: TapInputRef[]) => {
      const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: btcNet });
      const tx = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
      const prevScripts = psbt.data.inputs.map((i) => i.witnessUtxo!.script);
      const values = psbt.data.inputs.map((i) => i.witnessUtxo!.value);
      for (const inp of inputs) {
        const leafScript = Buffer.from(inp.tapLeafScriptHex, "hex");
        const leafHash = tapleafHash(leafScript);
        const sighash = tx.hashForWitnessV1(inp.index, prevScripts, values, bitcoin.Transaction.SIGHASH_DEFAULT, leafHash);
        const signature = Buffer.from(ecc.signSchnorr(sighash, priv));
        psbt.updateInput(inp.index, { tapScriptSig: [{ pubkey: xOnly, signature, leafHash }] });
      }
      return psbt.toBase64();
    },
  };

  // Key-path signer for the identity's own P2TR coins (used by the funding helper).
  const tweaked = child.tweak(bcrypto.taggedHash("TapTweak", xOnly));
  const signOwnKeyPath = (psbt: bitcoin.Psbt) => {
    psbt.signAllInputs({
      publicKey: Buffer.from(tweaked.publicKey),
      sign: () => { throw new Error("ECDSA not used for taproot"); },
      signSchnorr: (hash: Buffer) => Buffer.from(tweaked.signSchnorr(hash)),
    });
  };

  return { index, network, evmAddress: account.address, btcAddress: address, btcXOnlyPubkey: xOnly.toString("hex"), evmPath, btcPath, evmSigner, btcSigner, signOwnKeyPath };
}

/** Public view of an identity — safe to print and to write to the ledger. */
export const publicIdentity = (id: Identity) => ({
  index: id.index, network: id.network, evmAddress: id.evmAddress, btcAddress: id.btcAddress, btcXOnlyPubkey: id.btcXOnlyPubkey, evmPath: id.evmPath, btcPath: id.btcPath,
});

// ---------------------------------------------------------------- ledger ----

export interface LedgerEntry {
  index: number;
  network: Network;
  role: string;
  evmAddress: string;
  btcAddress: string;
  vaultAddress?: string;
  positionId?: string | null;
  fundingTxids: { asset: "BTC" | "USDC"; txid: string; amount: string; at: string }[];
  notes: string[];
  lastBalances?: { btcSats?: string; usdc?: string; at: string };
  createdAt: string;
  updatedAt: string;
}
export interface Ledger { version: 1; walletFingerprint: Record<string, string>; identities: Record<string, LedgerEntry> }

export function readLedger(): Ledger {
  ensureDir();
  if (!existsSync(LEDGER_FILE)) return { version: 1, walletFingerprint: {}, identities: {} };
  return JSON.parse(readFileSync(LEDGER_FILE, "utf8")) as Ledger;
}
export function writeLedger(ledger: Ledger) {
  ensureDir();
  writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
}
export const ledgerKey = (network: Network, index: number) => `${network}:${index}`;

export function upsertIdentity(ledger: Ledger, id: Identity, role: string, fingerprint: string): LedgerEntry {
  const key = ledgerKey(id.network, id.index);
  const now = new Date().toISOString();
  ledger.walletFingerprint[id.network] = fingerprint;
  const prev = ledger.identities[key];
  const entry: LedgerEntry = prev ?? { index: id.index, network: id.network, role, evmAddress: id.evmAddress, btcAddress: id.btcAddress, fundingTxids: [], notes: [], createdAt: now, updatedAt: now };
  if (prev && (prev.evmAddress !== id.evmAddress || prev.btcAddress !== id.btcAddress)) {
    throw new Error(`ledger entry ${key} was derived from a different wallet (fingerprint changed?). Refusing to overwrite.`);
  }
  entry.role = role || entry.role;
  entry.updatedAt = now;
  ledger.identities[key] = entry;
  return entry;
}
