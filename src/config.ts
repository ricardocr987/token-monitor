import { Solana } from "./solana";

export const config = {
    HOST: Bun.env.HOST || '127.0.0.1',
    PORT: Bun.env.PORT || 3001,
    
    RPC_KEY: Bun.env.RPC_KEY || '',
    RPC: new Solana(`https://mainnet.helius-rpc.com/?api-key=${Bun.env.RPC_KEY}`),
    TOKEN: Bun.env.TOKEN || '',

    FIREBASE_PROJECT_ID: Bun.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: Bun.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: Bun.env.FIREBASE_PRIVATE_KEY,
    FIREBASE_DATABASE: Bun.env.FIREBASE_DATABASE,
};

const requiredEnvVariables = [
    'RPC_KEY',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_DATABASE',
    'TOKEN'
];

requiredEnvVariables.forEach(variable => {
    if (config[variable as keyof typeof config] === '') {
        throw new Error(`Missing required environment variable: ${variable}`);
    }
});
