import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";
import type { Parser } from "./parser";
import type { Database } from "./db";
import { config } from "./config";

export class Fetcher {
  private db: Database;
  private parser!: Parser;

  constructor(db: Database) {
    this.db = db;
  }

  public async tokenMovements(account: string): Promise<void> {
    const pubkey = new PublicKey(account);
    await this.transactions(pubkey, async (transactions) => {
      await Promise.all(transactions.map(transaction => 
        this.parser.tokenMovements(transaction)
      ));
    }, 8);
  }

  public async mintFromHistory(keys: string[]): Promise<string> {
    const accountInfos = await config.RPC.getMultipleAccountsInfo(keys.map(x => new PublicKey(x)));
    
    for (const [_, accountInfo] of accountInfos.entries()) {
        if (accountInfo) return AccountLayout.decode(accountInfo.data).mint.toBase58();
    }

    for (const account of keys) {
        const pubkey = new PublicKey(account);
        const mint = await this.transactions(pubkey, async (transactions) => {
            for (const transaction of transactions) {
                const mint = await this.parser.mintFromHistory(transaction, account);
                if (mint) {
                  console.log('mint from history', mint);
                  return mint;
                }
              }
            return undefined;
        }, 5);

        if (mint) return mint;
    }

    return '';
  }

  private async transactions(
    pubkey: PublicKey,
    batchProcessor: (transactions: ParsedTransactionWithMeta[]) => Promise<string | undefined | void>,
    batchSize: number,
  ): Promise<string | undefined> {
    let before: string | undefined = undefined;
    const limit = batchSize;
  
    while (true) {
      const signatures = await config.RPC.getSignatures(pubkey, { before, limit });
      if (signatures.length === 0) break;
      before = signatures[signatures.length - 1].signature;

      const filteredSignatures = await this.filterExistingSignatures(signatures.filter(x => !x.err).map(x => x.signature));
      if (filteredSignatures.length === 0) continue;

      const rawTransactions = await config.RPC.getBatchTransactions(filteredSignatures);
      const transactions = rawTransactions.filter((tx): tx is ParsedTransactionWithMeta => tx !== null);
      if (transactions.length === 0) continue;

      const result = await batchProcessor(transactions);

      // note: needed for owner or mint from history
      if (result) return result;
    }
  
    console.log(`[getTransactions] Finished processing all transaction batches for account: ${pubkey.toBase58()}`);
    return undefined;
  }

  private async filterExistingSignatures(signatures: string[]): Promise<string[]> {
    const existenceChecks = signatures.map(signature => this.db.signatureExists(signature));
    const existenceResults = await Promise.all(existenceChecks);
    return signatures.filter((_, index) => !existenceResults[index]);
  }
}