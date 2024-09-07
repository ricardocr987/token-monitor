import { PublicKey } from "@solana/web3.js";
import { Parser } from "./parser";
import { Fetcher } from "./fetcher";
import { config } from "./config";
import { Listener } from "./listener";
import { Database } from "./db";
import Elysia from "elysia";

class MonitorToken {
    private parser: Parser;
    private fetcher: Fetcher;
    private listener: Listener;
    private db: Database;
  
    constructor() {
        this.db = new Database();
        
        this.parser = new Parser(this.db);
        this.fetcher = new Fetcher(this.db);
    
        Object.assign(this.parser, { fetcher: this.fetcher });
        Object.assign(this.fetcher, { parser: this.parser });
    
        this.listener = new Listener(this.parser);
    }

    async init(token: string): Promise<void> {
        try {
            console.log("Initializing monitor...");
            
            const mintAccountInfo = await config.RPC.getAccountInfo(new PublicKey(token));
            await this.parser.mint(token, mintAccountInfo);
            await this.fetcher.tokenMovements(token);

            console.log("Monitor initialized successfully");
        } catch (error) {
            console.error("Server initialization failed:", error);
            throw error;
        }
    }

    getListenerHandler() {
        return this.listener.getHandler();
    }

    getDatabase() {
        return this.db;
    }
}

const monitor = new MonitorToken();

type ListenOptions = {
    hostname: string;
    port: number;
}

new Elysia()
    .onError(({ code, error }) => {
        return {
            code: code ?? 500,
            error: error.message,
            success: false
        }
    })
    .mapResponse(({ response, set }) => {
        const isJson = typeof response === 'object';
        const responseBody = isJson ? response : { data: response, success: true };
        const text = JSON.stringify(responseBody);
        set.headers['Content-Encoding'] = 'gzip';
        set.headers['Content-Type'] = 'application/json; charset=utf-8';

        return new Response(
            Bun.gzipSync(new TextEncoder().encode(text)),
            { headers: set.headers }
        )   
    })
    .use(monitor.getListenerHandler())
    .get("/token-account/:address", ({ params }) => {
        const account = monitor.getDatabase().getTokenAccount(params.address);
        if (!account) console.error("Token account not found");
        
        return account;
    })
    .get("/balance/:address", ({ params }) => {
        const balance = monitor.getDatabase().getBalance(params.address);
        if (!balance) console.error("Balance not found");

        return { address: params.address, balance };
    })
    .get("/mint/:mintAddress", ({ params }) => {
        const mint = monitor.getDatabase().getMint(params.mintAddress);
        if (!mint) console.error("Mint not found");
        
        return mint;
    })
    .get("/all-balances", () => {
        const balances = monitor.getDatabase().getAllBalances();
        return Object.fromEntries(balances);
    })
    .get("/all-accounts", () => {
        return monitor.getDatabase().getAllTokenAccounts();
    })
    .get("/events", ({ params }) => {
        const { address, signature, type } = params;
        
        const events = monitor.getDatabase().getEvents({
          address: address as string | undefined,
          signature: signature as string | undefined,
          type: type as string | undefined
        });
      
        return events;
    })
    .listen({ hostname: config.HOST, port: config.PORT }, async ({ hostname, port }: ListenOptions) => {
        console.log(`Running at http://${hostname}:${port}`);
        await monitor.init(config.TOKEN);
    });