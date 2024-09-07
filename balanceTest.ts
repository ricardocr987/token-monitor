import ky from 'ky';
import { PublicKey } from "@solana/web3.js";
import { config } from "./src/config";
import type { TokenAccount } from './src/types';
import pako from 'pako';

const connection = config.RPC;
const API_BASE_URL = `http://104.248.242.172:3001`;

type BalanceResponse = {
  address: string;
  balance: string;
}

async function decompressResponse(response: Response): Promise<any> {
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const decompressed = pako.inflate(uint8Array, { to: 'string' });
  return JSON.parse(decompressed);
}

async function validateBalances() {
  console.log("Fetching all token accounts from the API...");
  const allAccountsResponse = await ky.get(`${API_BASE_URL}/all-accounts`, {
    headers: {
      'Accept-Encoding': 'gzip'
    }
  }).then(decompressResponse);
  const dbTokenAccounts = allAccountsResponse as TokenAccount[];

  console.log(`Validating ${dbTokenAccounts.length} token accounts...`);

  let correctBalances = 0;
  let mismatches = 0;

  for (const dbAccount of dbTokenAccounts) {
    const publicKey = new PublicKey(dbAccount.address);
    
    try {
      const accountInfo = await connection.getParsedAccountInfo(publicKey);
      
      let onchainBalanceDecimal = "0";  // Default to 0 if account doesn't exist

      if (accountInfo.value && 'parsed' in accountInfo.value.data) {
        const onchainData = accountInfo.value.data.parsed.info;
        
        if (onchainData.mint !== config.TOKEN) {
          console.log(`Skipping non-target token account: ${dbAccount.address}`);
          continue;
        }

        onchainBalanceDecimal = onchainData.tokenAmount.amount.toString();
      }

      const balanceResponse = await ky.get(`${API_BASE_URL}/balance/${dbAccount.address}`, {
        headers: {
          'Accept-Encoding': 'gzip'
        }
      }).then(decompressResponse) as BalanceResponse;
      const dbBalance = balanceResponse.balance;
      
      const dbBalanceDecimal = parseInt(dbBalance, 16).toString();
      
      if (onchainBalanceDecimal !== dbBalanceDecimal) {
        console.log(`Mismatch found for account ${dbAccount.address}:`);
        console.log(`  API balance: ${dbBalanceDecimal}`);
        console.log(`  On-chain balance: ${onchainBalanceDecimal}`);
        mismatches++;
      } else {
        console.log(`Account ${dbAccount.address} balance verified.`);
        correctBalances++;
      }
    } catch (error) {
      // If an error is thrown, it likely means the account doesn't exist on-chain
      console.log(`Account ${dbAccount.address} doesn't exist on-chain.`);
      
      const balanceResponse = await ky.get(`${API_BASE_URL}/balance/${dbAccount.address}`, {
        headers: {
          'Accept-Encoding': 'gzip'
        }
      }).then(decompressResponse) as BalanceResponse;
      const dbBalance = balanceResponse.balance;
      const dbBalanceDecimal = parseInt(dbBalance, 16).toString();
      
      if (dbBalanceDecimal !== "0") {
        console.log(`Mismatch found for non-existent account ${dbAccount.address}:`);
        console.log(`  API balance: ${dbBalanceDecimal}`);
        console.log(`  On-chain balance: 0`);
        mismatches++;
      } else {
        console.log(`Non-existent account ${dbAccount.address} correctly has 0 balance.`);
        correctBalances++;
      }
    }
  }

  const totalAccounts = correctBalances + mismatches;
  const accuracyPercentage = (correctBalances / totalAccounts) * 100;

  console.log("\nBalance validation complete.");
  console.log(`Total accounts checked: ${totalAccounts}`);
  console.log(`Good balances: ${correctBalances}`);
  console.log(`Mismatches: ${mismatches}`);
  console.log(`Accuracy: ${accuracyPercentage.toFixed(2)}%`);
}

validateBalances().then(() => {
  console.log("Script finished.");
  process.exit(0);
}).catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});