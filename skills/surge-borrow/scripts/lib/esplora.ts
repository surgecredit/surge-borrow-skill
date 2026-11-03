/** Minimal esplora client for the harness (balances, UTXOs, broadcast, confirmation polling). Public data only. */
export interface Utxo { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } }

export class Esplora {
  constructor(readonly base: string) {}
  private async get(path: string): Promise<string> {
    const r = await fetch(`${this.base}${path}`);
    if (!r.ok) throw new Error(`esplora GET ${path} -> ${r.status} ${await r.text().catch(() => "")}`);
    return r.text();
  }
  async tipHeight() { return Number(await this.get("/blocks/tip/height")); }
  async utxos(address: string): Promise<Utxo[]> { return JSON.parse(await this.get(`/address/${address}/utxo`)) as Utxo[]; }
  async balanceSats(address: string): Promise<{ confirmed: bigint; unconfirmed: bigint }> {
    const u = await this.utxos(address);
    return { confirmed: u.filter((x) => x.status.confirmed).reduce((a, x) => a + BigInt(x.value), 0n), unconfirmed: u.filter((x) => !x.status.confirmed).reduce((a, x) => a + BigInt(x.value), 0n) };
  }
  async txStatus(txid: string): Promise<{ confirmed: boolean; block_height?: number }> { return JSON.parse(await this.get(`/tx/${txid}/status`)) as { confirmed: boolean; block_height?: number }; }
  async txHex(txid: string) { return this.get(`/tx/${txid}/hex`); }
  async broadcast(rawHex: string): Promise<string> {
    const r = await fetch(`${this.base}/tx`, { method: "POST", body: rawHex });
    const t = await r.text();
    if (!r.ok) throw new Error(`broadcast failed ${r.status}: ${t}`);
    return t.trim();
  }
  /** Wait until the tx has `confs` confirmations (tip − height + 1). */
  async waitForConfirmations(txid: string, confs = 1, { intervalMs = 15_000, timeoutMs = 60 * 60_000, onTick }: { intervalMs?: number; timeoutMs?: number; onTick?: (confs: number) => void } = {}): Promise<number> {
    const started = Date.now();
    for (;;) {
      const st = await this.txStatus(txid).catch(() => ({ confirmed: false }) as { confirmed: boolean; block_height?: number });
      if (st.confirmed && st.block_height) {
        const n = (await this.tipHeight()) - st.block_height + 1;
        onTick?.(n);
        if (n >= confs) return n;
      } else onTick?.(0);
      if (Date.now() - started > timeoutMs) throw new Error(`tx ${txid} did not reach ${confs} confirmations within ${timeoutMs / 60000} min`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
