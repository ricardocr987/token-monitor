import { PublicKey } from "@solana/web3.js";

export interface Mint {
    mintAuthorityOption: number;
    mintAuthority: PublicKey | null;
    supply: bigint;
    decimals: number;
    isInitialized: boolean;
    freezeAuthorityOption: number;
    freezeAuthority: PublicKey | null;
}

export interface ParsedMint {
    mint: string;
    mintAuthorityOption: number;
    mintAuthority: string;
    supply: string;
    decimals: number;
    isInitialized: boolean;
    freezeAuthorityOption: number;
    freezeAuthority: string;
}

export interface TokenAccountInfo {
    address: string;
    owner: string;
}

export interface Event {
    signature: string;
    type: 'transfer' | 'mint' | 'burn' | 'initAccount';
    signers: string[];
    mint: string;
    amount?: string;
    source?: string;
    destination?: string;
    owner?: string;
  }

export interface TokenAccount {
    address: string;
    mint: string;
    owner: string;
    balance: string;
}
