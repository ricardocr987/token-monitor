import { MintLayout } from "./solana";
import { Database } from "./db";
import { Fetcher } from './fetcher';
import { config } from './config';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { type ParsedMint, type Mint } from "./types";
import { 
    type ParsedTransactionWithMeta,
    type ParsedInstruction,
    type AccountInfo,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { hexToBN, bnToHex } from "./numbers";

export class Parser {
    private db: Database;
    private fetcher!: Fetcher;

    constructor(db: Database) {
        this.db = db;
    }

    public async tokenMovements(transaction: ParsedTransactionWithMeta): Promise<void> {
        await this.parseInstructions(transaction, async (instruction, info) => {
            const { type } = instruction.parsed;
            const signature = transaction.transaction.signatures[0];
            const signers = transaction.transaction.message.accountKeys
                .filter(x => x.signer)
                .map(x => String(x.pubkey));

            switch (true) {
                case type.includes('initializeAccount'):
                    if (!info.mint) return null;
                    await this.handleInitAccount(info, signers, signature);
                    break;

                case type === 'transfer' || type === 'transferChecked':
                    if (!info.mint) info.mint = await this.getMint([info.source, info.destination]);
                    await this.handleTransfer(info, signers, signature);
                    break;

                case type === 'mintTo' || type === 'mintToChecked':
                    await this.handleMint(info, signers, signature);
                    break;

                case type === 'burn' || type === 'burnChecked':
                    await this.handleBurn(info, signers, signature);
                    break;

                default:
                    break;
            }

            return null;
        });
    }

    public async mintFromHistory(transaction: ParsedTransactionWithMeta, account: string): Promise<string | null> {
        return await this.parseInstructions(transaction, async (instruction, info) => {
            if (this.isValidInstruction(instruction, info, account)) {
                await this.db.saveTokenAccount({ 
                    address: account, 
                    mint: config.TOKEN, 
                    owner: info.owner, 
                    balance: '0' 
                });
                return info.mint;
            } 
            
            if (this.isRelatedAccount(info, account) && info.mint && info.mint !== config.TOKEN) {
                return '';
            }
        
            return null;
        });
    }

    private isRelatedAccount(info: any, account: string): boolean {
        return info.account === account || info.destination === account || info.source === account;
    }

    private isValidInstruction(instruction: ParsedInstruction, info: any, account: string): boolean {
        return (
            instruction.program === 'spl-token' &&
            info.account === account &&
            info.mint === config.TOKEN &&
            'owner' in info
        );
    }

    private async parseInstructions(
        transaction: ParsedTransactionWithMeta,
        callback: (instruction: ParsedInstruction, info: any) => Promise<string | null>
    ): Promise<string | null> {
        if (!transaction.meta?.innerInstructions) return null;
        for (const innerInstruction of transaction.meta.innerInstructions) {
            for (const instruction of innerInstruction.instructions) {
                if ('parsed' in instruction && instruction.program === 'spl-token') {
                    const result = await callback(instruction as ParsedInstruction, instruction.parsed.info);
                    if (result) return result;
                }
            }
        }

        return null;
    }

    public async mint(mint: string, accountInfo: AccountInfo<Buffer> | null): Promise<void> {
        if (!accountInfo || !accountInfo.owner.equals(TOKEN_PROGRAM_ID)) return;
        
        const decodedMintData: Mint = MintLayout.decode(accountInfo.data);
        const mintData: ParsedMint = {
            mint,
            mintAuthorityOption: decodedMintData.mintAuthorityOption,
            mintAuthority: decodedMintData.mintAuthority?.toBase58() || '',
            supply: '0',
            decimals: decodedMintData.decimals,
            isInitialized: decodedMintData.isInitialized,
            freezeAuthorityOption: decodedMintData.freezeAuthorityOption,
            freezeAuthority: decodedMintData.freezeAuthority?.toBase58() || '',
        };

        await this.db.saveMint(mintData);
    }

    private async handleInitAccount(info: any, signers: string[], signature: string): Promise<void> {
        const { account: address, owner, mint } = info;
        if (mint !== config.TOKEN) return;

        const tokenAccount = { address, mint: config.TOKEN, owner };
        if (!await this.db.tokenAccountExists(address)) {
            await this.db.saveTokenAccount({...tokenAccount, balance: '0'});
        }

        await this.db.saveEvent({
            signature,
            type: 'initAccount',
            signers,
            ...tokenAccount
        });
    }

    private async handleTransfer(info: any, signers: string[], signature: string): Promise<void> {
        const { source, destination, amount, mint } = info;
        if (mint !== config.TOKEN) return;

        const amountBN = new BN(amount);
        await Promise.all([
            this.updateBalances(source, amountBN.neg(), destination, amountBN),
            this.db.saveEvent({
                signature,
                type: 'transfer',
                signers,
                ...info,
                amount: bnToHex(amountBN),
            })
        ]);
    }

    private async handleMint(info: any, signers: string[], signature: string): Promise<void> {
        const { mint, account: destination, amount } = info;
        if (mint !== config.TOKEN) return;

        const amountBN = new BN(amount);
        await Promise.all([
            this.updateBalances(null, new BN(0), destination, amountBN),
            this.updateSupply(mint, amountBN),
            this.db.saveEvent({
                signature,
                type: 'mint',
                destination,
                mint,
                amount: bnToHex(amountBN),
                signers,
            })
        ]);
    }

    private async handleBurn(info: any, signers: string[], signature: string): Promise<void> {
        const { mint, account: source, amount } = info;
        if (mint !== config.TOKEN) return;

        const amountBN = new BN(amount);
        await Promise.all([
            this.updateBalances(source, amountBN.neg(), null, new BN(0)),
            this.updateSupply(mint, amountBN.neg()),
            this.db.saveEvent({
                signature,
                type: 'burn',
                source,
                mint,
                amount: bnToHex(amountBN),
                signers,
            })
        ]);
    }

    private async updateBalances(fromAddress: string | null, fromAmount: BN, toAddress: string | null, toAmount: BN): Promise<void> {
        if (fromAddress) {
            const fromBalance = await this.getBalance(fromAddress);
            const newFromBalance = fromBalance.add(fromAmount);
            await this.db.updateBalance(fromAddress, bnToHex(newFromBalance));
        }

        if (toAddress) {
            const toBalance = await this.getBalance(toAddress);
            const newToBalance = toBalance.add(toAmount);
            await this.db.updateBalance(toAddress, bnToHex(newToBalance));
        }
    }

    private async updateSupply(mintAddress: string, amount: BN): Promise<void> {
        const currentSupply = await this.getSupply(mintAddress);
        const newSupply = currentSupply.add(amount);
        await this.db.updateTokenSupply(mintAddress, bnToHex(newSupply));
    }

    private async getMint(addresses: string[]): Promise<string> {
        const mint = await this.db.mintFromAccounts(addresses);
        return mint ? mint : await this.fetcher.mintFromHistory(addresses)
    }

    private async getBalance(address: string): Promise<BN> {
        const tokenAccount = await this.db.getTokenAccount(address);
        const hexBalance = tokenAccount?.balance;
        return hexBalance ? hexToBN(hexBalance) : new BN(0);
    }

    private async getSupply(mintAddress: string): Promise<BN> {
        const hexSupply = await this.db.getTokenSupply(mintAddress);
        return hexSupply ? hexToBN(hexSupply) : new BN(0);
    }
}