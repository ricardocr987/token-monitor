import { Database as BunDB, Statement } from "bun:sqlite";
import { type ParsedMint, type TokenAccount, type Event } from "./types";
import { file } from "bun";

export class Database implements Database {
    private db: BunDB;
    private saveTokenAccountStmt: Statement;
    private saveEventStmt: Statement;
    private saveMintStmt: Statement;
    private updateBalanceStmt: Statement;
    private updateTokenSupplyStmt: Statement;

    constructor(filename: string = "db") {
        const isNewDatabase = filename === "db" || !file(filename).exists();

        this.db = new BunDB(filename, { create: true });

        if (isNewDatabase) {
            this.initializeDatabase();
        } else {
            this.validateDatabase();
        }

        this.saveTokenAccountStmt = this.db.prepare(`
            INSERT OR REPLACE INTO tokenAccounts (address, mint, owner, balance)
            VALUES ($address, $mint, $owner, $balance)
        `);
        this.saveEventStmt = this.db.prepare(`
            INSERT OR REPLACE INTO events (signature, type, data) VALUES ($signature, $type, $data)
        `);
        this.saveMintStmt = this.db.prepare(`
            INSERT OR REPLACE INTO mints (
                mint, mintAuthorityOption, mintAuthority, supply, decimals,
                isInitialized, freezeAuthorityOption, freezeAuthority
            ) VALUES ($mint, $mintAuthorityOption, $mintAuthority, $supply, $decimals,
                      $isInitialized, $freezeAuthorityOption, $freezeAuthority)
        `);
        this.updateBalanceStmt = this.db.prepare(`
            UPDATE tokenAccounts SET balance = $balance WHERE address = $address
        `);
        this.updateTokenSupplyStmt = this.db.prepare(`
            UPDATE mints SET supply = $supply WHERE mint = $mint
        `);
    }

    private initializeDatabase() {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA synchronous = normal;");
        this.db.run(`
            CREATE TABLE IF NOT EXISTS events (
                signature TEXT PRIMARY KEY,
                type TEXT,
                data TEXT
            );
            CREATE TABLE IF NOT EXISTS mints (
                mint TEXT PRIMARY KEY,
                mintAuthorityOption INTEGER,
                mintAuthority TEXT,
                supply TEXT,
                decimals INTEGER,
                isInitialized INTEGER,
                freezeAuthorityOption INTEGER,
                freezeAuthority TEXT
            );
            CREATE TABLE IF NOT EXISTS tokenAccounts (
                address TEXT PRIMARY KEY,
                mint TEXT,
                owner TEXT,
                balance TEXT
            );
            PRAGMA user_version = 1;
        `);
    }

    private validateDatabase() {
        const version = this.db.query("PRAGMA user_version").get() as { user_version: number };
        
        if (version.user_version === 0) {
            this.db.run("PRAGMA user_version = 1");
        } else if (version.user_version !== 1) {
            console.warn("Database version mismatch. You may need to upgrade the schema.");
        }

        this.db.exec("PRAGMA journal_mode = WAL;");
    }

    public signatureExists(signature: string): boolean {
        const result = this.db.query("SELECT 1 FROM events WHERE signature = $signature").get({ $signature: signature });
        return !!result;
    }

    public tokenAccountExists(address: string): boolean {
        const result = this.db.query("SELECT 1 FROM tokenAccounts WHERE address = $address").get({ $address: address });
        return !!result;
    }

    public saveEvent(event: Event): void {
        this.saveEventStmt.run({
            $signature: event.signature,
            $type: event.type,
            $data: JSON.stringify(event)
        });
    }

    public saveMint(mintData: ParsedMint): void {
        this.saveMintStmt.run({
            $mint: mintData.mint,
            $mintAuthorityOption: mintData.mintAuthorityOption,
            $mintAuthority: mintData.mintAuthority,
            $supply: mintData.supply,
            $decimals: mintData.decimals,
            $isInitialized: mintData.isInitialized ? 1 : 0,
            $freezeAuthorityOption: mintData.freezeAuthorityOption,
            $freezeAuthority: mintData.freezeAuthority
        });
    }

    public saveTokenAccount(tokenAccount: TokenAccount): void {
        this.saveTokenAccountStmt.run({
            $address: tokenAccount.address,
            $mint: tokenAccount.mint,
            $owner: tokenAccount.owner,
            $balance: tokenAccount.balance
        });
    }

    public updateBalance(address: string, balance: string): void {
        this.updateBalanceStmt.run({ $balance: balance, $address: address });
    }

    public updateTokenSupply(mintAddress: string, supply: string): void {
        this.updateTokenSupplyStmt.run({ $supply: supply, $mint: mintAddress });
    }

    public getMint(mintAddress: string): ParsedMint | null {
        const result = this.db.query(`
            SELECT * FROM mints WHERE mint = ?
        `).get(mintAddress);
        return result ? result as ParsedMint : null;
    }

    public getMintFromAccounts(accounts: string[]): string | null {
        const placeholders = accounts.map((_, i) => `$${i}`).join(',');
        const result = this.db.query(`
            SELECT mint FROM tokenAccounts 
            WHERE address IN (${placeholders})
            GROUP BY mint
            HAVING COUNT(DISTINCT mint) = 1
        `).get(...accounts) as { mint: string } | null;
        return result ? result.mint : null;
    }

    public getBalance(address: string): string | null {
        const result = this.db.query(`
            SELECT balance FROM tokenAccounts WHERE address = ?
        `).get(address) as { balance: string } | null;
        return result ? result.balance : null;
    }

    public getAllBalances(): Map<string, string> {
        const results = this.db.query(`
            SELECT address, balance FROM tokenAccounts
        `).all() as { address: string, balance: string }[];
        const balances = new Map<string, string>();
        for (const row of results) {
            balances.set(row.address, row.balance);
        }
        return balances;
    }

    public getAllTokenAccounts(): TokenAccount[] {
        return this.db.query("SELECT * FROM tokenAccounts").all() as TokenAccount[];
    }

    public getEvents(options: {
        address?: string;
        signature?: string;
        type?: string;
    }): Event[] {
        let query = "SELECT * FROM events";
        const conditions: string[] = [];
        const params: any[] = [];
    
        if (options.signature) {
            conditions.push("signature = ?");
            params.push(options.signature);
        }
    
        if (options.type) {
            conditions.push("type = ?");
            params.push(options.type);
        }
    
        if (options.address) {
            conditions.push("JSON_EXTRACT(data, '$.signers') LIKE ?");
            params.push(`%${options.address}%`);
        }
    
        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }
    
        const results = this.db.query(query).all(...params);
        return results.map((row: any) => JSON.parse(row.data as string) as Event);
    }

    public getTokenAccount(address: string): TokenAccount | null {
        const result = this.db.query("SELECT * FROM tokenAccounts WHERE address = ?").get(address);
        return result as TokenAccount | null;
    }

    public getTokenSupply(mintAddress: string): string | null {
        const result = this.db.query("SELECT supply FROM mints WHERE mint = ?").get(mintAddress) as { supply: string } | null;
        return result ? result.supply : null;
    }

    public transaction<T>(callback: () => T): T {
        return this.db.transaction(callback)();
    }
}