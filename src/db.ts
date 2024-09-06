import { getDatabase } from "firebase-admin/database";
import admin from "firebase-admin";
import { config } from "./config";
import { type ParsedMint, type TokenAccount } from "./types";

const app = admin.apps.find((it: any) => it?.name === "[DEFAULT]") ||
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: config.FIREBASE_PROJECT_ID,
            clientEmail: config.FIREBASE_CLIENT_EMAIL,
            privateKey: config.FIREBASE_PRIVATE_KEY!.replace(/\\n/gm, "\n"),
        }),
        databaseURL: config.FIREBASE_DATABASE
    });

const database = getDatabase(app);

export class Database {
    private eventsRef = database.ref('events');
    private mintsRef = database.ref('mints');
    private tokenAccountsRef = database.ref('tokenAccounts');

    public async signatureExists(signature: string): Promise<boolean> {
        const snapshot = await this.eventsRef.child('signatures').child(signature).once('value');
        return snapshot.exists();
    }

    public async tokenAccountExists(address: string): Promise<boolean> {
        const snapshot = await this.tokenAccountsRef.child(address).once('value');
        return snapshot.exists();
    }

    public async mintFromAccounts(accounts: string[]): Promise<string | null> {
        for (const account of accounts) {
            const tokenAccount = await this.getTokenAccount(account);
            if (tokenAccount && tokenAccount.mint) {
                const mint = await this.getMint(tokenAccount.mint);
                if (mint) {
                    return mint.mint;
                }
            }
        }
    
        return null;
    }

    public async saveEvent(event: any): Promise<void> {
        const updates: { [key: string]: any } = {};
        updates[`${event.type}/${event.signature}`] = event;
        updates[`signatures/${event.signature}`] = true;
        await this.eventsRef.update(updates);
    }

    public async saveMint(mintData: ParsedMint): Promise<void> {
        await this.mintsRef.child(mintData.mint).set(mintData);
    }

    public async saveTokenAccount(tokenAccount: TokenAccount): Promise<void> {
        await this.tokenAccountsRef.child(tokenAccount.address).set(tokenAccount);
    }

    public async updateBalance(address: string, balance: string): Promise<void> {
        await this.tokenAccountsRef.child(address).update({ balance });
    }

    public async updateTokenSupply(mintAddress: string, supply: string): Promise<void> {
        await this.mintsRef.child(mintAddress).update({ supply });
    }

    public async getMint(mintAddress: string): Promise<ParsedMint | null> {
        const snapshot = await this.mintsRef.child(mintAddress).once('value');
        return snapshot.exists() ? snapshot.val() as ParsedMint : null;
    }

    public async getBalance(address: string): Promise<string | null> {
        const snapshot = await this.tokenAccountsRef.child(address).child('balance').once('value');
        return snapshot.val();
    }

    public async getAllBalances(): Promise<Map<string, string>> {
        const snapshot = await this.tokenAccountsRef.once('value');
        const balances = new Map<string, string>();
        snapshot.forEach((childSnapshot) => {
            const tokenAccount = childSnapshot.val();
            if (tokenAccount.balance) {
                balances.set(childSnapshot.key!, tokenAccount.balance);
            }
        });
        return balances;
    }

    public async getTokenSupply(mintAddress: string): Promise<string | null> {
        const mint = await this.getMint(mintAddress);
        return mint ? mint.supply : null;
    }

    public async getTokenAccount(address: string): Promise<any | null> {
        const snapshot = await this.tokenAccountsRef.child(address).once('value');
        return snapshot.exists() ? snapshot.val() : null;
    }
}