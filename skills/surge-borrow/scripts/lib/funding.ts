/**
 * Funding helper (brief §7): identity 0 pays vaults and other identities with its own
 * key-path P2TR spends, built and broadcast through esplora. Only test coins on Surge's
 * signet ever pass through here; the mainnet paid run uses the same code with a separate wallet.
 */
import * as bitcoin from "bitcoinjs-lib";
import type { Network } from "@surgecredit/borrow-sdk";
import type { Identity } from "./wallet";
import { Esplora, type Utxo } from "./esplora";

const DUST = 546n;
/** vbytes for a key-path P2TR spend: overhead 10.5, 57.5 per input, 43 per P2TR output (rounded up). */
export const estimateVbytes = (inputs: number, outputs: number) => Math.ceil(10.5 + 57.5 * inputs + 43 * outputs);

export interface SendResult { txid: string; feeSats: bigint; inputs: number; changeSats: bigint }

export async function sendFromIdentity(p: { from: Identity; toAddress: string; amountSats: bigint; feeRate: number; esplora: Esplora; network: Network; onlyConfirmed?: boolean }): Promise<SendResult> {
  const { from, toAddress, amountSats, feeRate, esplora } = p;
  if (amountSats <= DUST) throw new Error(`amount ${amountSats} is dust`);
  const btcNet = p.network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
  const all = await esplora.utxos(from.btcAddress);
  const spendable = (p.onlyConfirmed ?? true ? all.filter((u) => u.status.confirmed) : all).sort((a, b) => b.value - a.value);
  const selected: Utxo[] = [];
  let total = 0n;
  let fee = 0n;
  for (const u of spendable) {
    selected.push(u);
    total += BigInt(u.value);
    fee = BigInt(Math.ceil(estimateVbytes(selected.length, 2) * feeRate));
    if (total >= amountSats + fee) break;
  }
  if (total < amountSats + fee) throw new Error(`insufficient funds in identity ${from.index}: have ${total} sats confirmed, need ${amountSats + fee} (amount + fee)`);
  let change = total - amountSats - fee;
  let outputs = 2;
  if (change <= DUST) { fee += change; change = 0n; outputs = 1; }

  const xOnly = Buffer.from(from.btcXOnlyPubkey, "hex");
  const psbt = new bitcoin.Psbt({ network: btcNet });
  const script = bitcoin.address.toOutputScript(from.btcAddress, btcNet);
  for (const u of selected) psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script, value: BigInt(u.value) }, tapInternalKey: xOnly });
  psbt.addOutput({ address: toAddress, value: amountSats });
  if (outputs === 2) psbt.addOutput({ address: from.btcAddress, value: change });
  from.signOwnKeyPath(psbt);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const txid = await esplora.broadcast(tx.toHex());
  return { txid, feeSats: fee, inputs: selected.length, changeSats: change };
}
