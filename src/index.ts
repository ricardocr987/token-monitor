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
}

const monitor = new MonitorToken();

type ListenOptions = {
    hostname: string;
    port: number;
}

new Elysia()
    .use(monitor.getListenerHandler())
    .listen({ hostname: config.HOST, port: config.PORT }, async ({ hostname, port }: ListenOptions) => {
        console.log(`Running at http://${hostname}:${port}`);
        await monitor.init(config.TOKEN);
    });