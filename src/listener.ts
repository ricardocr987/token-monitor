import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { Parser } from "./parser";
import { Elysia } from "elysia";
import { config } from "./config";

export class Listener {
    private parser: Parser;
    private app: Elysia;

    constructor(parser: Parser) {
        this.parser = parser;
        this.app = new Elysia();
        this.setupRoutes();
    }

    private setupRoutes() {
        this.app.post('/programListener', async ({ body, headers }) => {
            try {
                const authToken = headers['authorization'];
                if (!authToken || authToken !== config.RPC_KEY) {
                    console.error(`Unauthorized request`);
                    return new Response(JSON.stringify({ error: "Unauthorized" }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                const signatures = (body as any).flatMap((x: any) => x.transaction.signatures);
                const confirmationPromises = signatures.map((signature: string) => config.RPC.getConfirmation(signature));
                const confirmationResults = await Promise.all(confirmationPromises);
                const confirmedSignatures = signatures.filter((_: string, index: number) => confirmationResults[index] !== null);
            
                if (confirmedSignatures.length === 0) {
                  console.log('No transactions were confirmed');
                  return { success: false, message: 'No transactions were confirmed' };
                }
            
                console.log(`Confirmed signatures: ${confirmedSignatures}`);
                const rawTransactions = await config.RPC.getBatchTransactions(signatures);
                const transactions = rawTransactions.filter((tx): tx is ParsedTransactionWithMeta => tx !== null);
                for (const transaction of transactions) {
                    await this.parser.tokenMovements(transaction);
                }
                
                return { success: true, message: 'Transactions processed successfully' };
            } catch (error) {
                console.error('Failed to process transactions:', error);
                return { success: false, message: 'Failed to process transactions' };
            }
        });
    }

    public getHandler() {
        return this.app;
    }
}