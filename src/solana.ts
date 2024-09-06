import { Connection, PublicKey, type ParsedTransactionWithMeta, type ConfirmedSignatureInfo, type GetProgramAccountsConfig } from "@solana/web3.js";
import { struct, u32, u64, u8, publicKey } from "@coral-xyz/borsh";
import ky from "ky";

export const MintLayout = struct([
    u32("mintAuthorityOption"),
    publicKey("mintAuthority"),
    u64("supply"),
    u8("decimals"),
    u8("isInitialized"),
    u32("freezeAuthorityOption"),
    publicKey("freezeAuthority"),
]);

export interface TokenOwner {
    owner: PublicKey;
}

export const TokenOwnerLayout = struct<TokenOwner>([
    publicKey('owner'),
]);

export class Solana extends Connection {
    private readonly ky: typeof ky;
    public endpoint: string;

    constructor(endpoint: string) {
        super(endpoint);
        this.endpoint = endpoint;

        this.ky = ky.create({
            retry: {
                limit: 5,
                methods: ['post'],
                statusCodes: [408, 413, 429, 500, 502, 503, 504],
                backoffLimit: 15000,
                delay: (attemptCount) => 1000 * Math.pow(2, attemptCount - 1),
            },
            timeout: 30000,
        });
    }

    async getSignatures(
        address: PublicKey,
        options?: any
    ): Promise<ConfirmedSignatureInfo[]> {
        return await this.rpcRequest<ConfirmedSignatureInfo[]>('getSignaturesForAddress', [
            address.toBase58(),
            {
                commitment: 'confirmed',
                encoding: 'jsonParsed',
                maxSupportedTransactionVersion: 0,
                ...options,
            },
        ]);
    }

    async getBatchTransactions(
        signatures: string[],
    ): Promise<(ParsedTransactionWithMeta | null)[]> {
        try {
            const requests: RpcRequest[] = signatures.map(signature => ({
                method: 'getTransaction',
                params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
            }));

            return await this.batchRequest<ParsedTransactionWithMeta | null>(requests);
        } catch (error) {
            console.error('getBatchTransactions error:', error);
            throw error;
        }
    }

    async getConfirmation(
        signature: string,
        maxRetries: number = 10,
        retryDelay: number = 2000
    ): Promise<string | null> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const result = await this.getSignatureStatus(signature, {
                searchTransactionHistory: true,
            });
            const status = result.value?.confirmationStatus;
        
            if (status === 'confirmed' || status === 'finalized') {
                return status;
            }
        
            console.log(`Attempt ${attempt + 1}: Transaction not yet confirmed. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      
        console.error(`Transaction not confirmed after ${maxRetries} attempts.`);
        return null;
    }

    private async rpcRequest<T>(method: string, params: any[]): Promise<T> {
        try {
            const response = await this.ky.post(this.endpoint, {
                json: {
                    jsonrpc: '2.0',
                    id: 1,
                    method,
                    params,
                },
            });

            const data = await response.json() as RpcResponse;

            if ('error' in data) {
                throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
            }

            return data.result as T;
        } catch (error: any) {
            console.error('RPC Request failed:', error.message);
            console.error('Request details:', JSON.stringify({ method, params }, null, 2));
            throw error;
        }
    }

    private async batchRequest<T>(requests: RpcRequest[]): Promise<T[]> {
        try {
            const json = requests.map((req, index) => ({
                jsonrpc: '2.0',
                id: index,
                method: req.method,
                params: req.params,
            }));
    
            const response = await this.ky.post(this.endpoint, { json });
            const results = await response.json() as RpcResponse[];
            
            return results
                .sort((a, b) => (a.id as number) - (b.id as number))
                .filter(result => !('error' in result))
                .map(result => result.result as T);
        } catch (error) {
            console.error('Batch RPC request failed:', error);
            throw error;
        }
    }
}

interface RpcRequest {
    method: string;
    params: any[];
}

interface RpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}