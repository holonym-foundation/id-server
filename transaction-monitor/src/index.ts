import axios from "axios";
import { ethers } from "ethers";
import { promises as fs } from "fs";
import { JSONFilePreset } from 'lowdb/node'
import { ObjectId } from 'mongodb'
import logUpdate from "log-update";
import {
  auroraProvider,
  avalancheProvider,
  baseProvider,
  ethereumProvider,
  fantomProvider,
  idServerPaymentAddress,
  optimismGoerliProvider,
  optimismProvider,
  sessionStatusEnum,
  supportedChainIds,
} from "./constants/misc.js";
import { AMLChecksSession, Session } from "./init.js";
import { logAndPersistLogUpdate } from './logger.js';
import { idServerAdmin, phoneServerAdmin } from './admin-calls.js'
import { getAllPhoneSessions } from './dynamodb.js'

const txHashesIdServerDbName = "processedTxHashesIdServer.json";
const txHashesPhoneServerDbName = "processedTxHashesIdServer.json";
const defaultDbValue = ['0x2287db81fb436c58f53c62cb700e7198f99a522fa8352f6cbcbae7e75489bca1']
const moralisApiKey = process.env.MORALIS_API_KEY!

async function isProcessedForIdServer(hash: string): Promise<boolean> {
  const db = await JSONFilePreset(txHashesIdServerDbName, defaultDbValue)
  return db.data.includes(hash)
}

async function setProcessedForIdServer(hash: string) {
  const db = await JSONFilePreset(txHashesIdServerDbName, defaultDbValue)
  await db.update((txHashes: string[]) => txHashes.push(hash))
}

async function isProcessedForPhoneServer(hash: string): Promise<boolean> {
  const db = await JSONFilePreset(txHashesPhoneServerDbName, defaultDbValue)
  return db.data.includes(hash)
}

async function setProcessedForPhoneServer(hash: string) {
  const db = await JSONFilePreset(txHashesPhoneServerDbName, defaultDbValue)
  await db.update((txHashes: string[]) => txHashes.push(hash))
}

// Mapping chain IDs to their respective providers
const chainProviders: Record<number, ethers.providers.JsonRpcProvider> = {
  1: ethereumProvider,
  10: optimismProvider,
  // 250: fantomProvider, // ignoring fantom for now
  8453: baseProvider,
  43114: avalancheProvider,
  1313161554: auroraProvider,
};

// Function to fetch transactions from the last 48 hours for an address
async function getTransactionsHashesByChainLast48Hrs(ourAddress: string) {
  const chainIds = Object.keys(chainProviders).map(Number);

  const results = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      const provider = chainProviders[chainId];
      try {
        const latestBlock = await provider.getBlockNumber();
        // TODO: Make this more sophisticated. We can only query 10,000 blocks (for some chains; for others, 
        // it's ~2k) at a time. We should get all blocks within the last 48 hours, and then all blocks 
        // within last year. For now, we just get the last 2,000 blocks.
        const startBlock = latestBlock - 2_000; 
        // const blocksPerDay = 7200; // Approx. 15s per block
        // const startBlock = latestBlock - blocksPerDay * 2; // 48 hours ago

        logAndPersistLogUpdate(
          `Fetching transactions for ${ourAddress} on chain ${chainId} from block ${startBlock} to ${latestBlock}`,
        );

        // Use getLogs() to fetch transactions within the block range
        const logs = await provider.getLogs({
          fromBlock: startBlock,
          toBlock: latestBlock,
          address: ourAddress,
        });

        logAndPersistLogUpdate('logs', logs)

        // Extract transaction hashes from logs
        const txHashes = logs.map((log) => log.transactionHash);

        return { chainId, txHashes };
      } catch (error) {
        logAndPersistLogUpdate(
          `Error fetching transactions from chain ${chainId}:`,
          error,
        );
        return { chainId, txHashes: [] };
      }
    }),
  );

  // Convert results into an object mapping chainId to transaction hashes
  const txHashesByChain: Record<number, string[]> = {};
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      txHashesByChain[result.value.chainId] = result.value.txHashes;
    }
  });

  return txHashesByChain;
}

async function getTransaction(chainId: number, txHash: string) {
  const provider = chainProviders[chainId];
  return provider.getTransaction(txHash);
}

// type SessionType = {
//     _id: string;
//     status: keyof typeof sessionStatusEnum;
//     chainId: number;
//     txHash: string;
// }


async function getLast24HoursOfAuroraTransactions(ourAddress: string) {
  const provider = auroraProvider;
  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
  const timeWindowInSeconds = 24 * 60 * 60; // 24 hours in seconds
  const startTime = currentTime - timeWindowInSeconds;

  let transactions = [];
  let currentBlockNumber = await provider.getBlockNumber();

  while (true) {
    const block = await provider.getBlock(currentBlockNumber);

    if (!block) {
      // logAndPersistLogUpdate("block is null");
      break;
    }
    if (block.timestamp < startTime) {
      // logAndPersistLogUpdate("reached blocks older than the start time");
      break; // Stop when we reach blocks older than the start time
    }
    if (!block.transactions) {
      logAndPersistLogUpdate("block.transactions is null");
      break;
    }
    for (const txHash of block.transactions) {
      // logAndPersistLogUpdate("txHash", txHash);
      try {
        const tx = await provider.getTransaction(txHash);
        if (tx && (tx.to === ourAddress)) {
          // logAndPersistLogUpdate("tx", tx);
          transactions.push(tx);
        }
      } catch (error) {
        logAndPersistLogUpdate(`Error fetching transaction ${txHash}:`, error);
      }
    }

    currentBlockNumber--;
  }

  return transactions;
}


// chainId -> Moralis chain param
const chainIdToMoralisChainParam: Record<number, string> = {
  1: "0x1",             // Ethereum
  10: "0xa",            // Optimism
  // 250: "0xfa",         // Fantom // ? discuss with team as fantom is sonic now 
  8453: "0x2105",         // Base mainnet
  43114: "0xa86a",      // Avalanche C-chain
  // 1313161554: "0x4e454153", // Aurora  // ? moralis does not support this chain
};


async function fetchMoralisTxsForChain({
  address,
  chainId,
  fromDate,
  toDate,
}: {
  address: string;
  chainId: number;
  fromDate: string;
  toDate: string;
}) {
  const chainParam = chainIdToMoralisChainParam[chainId];
  if (!chainParam) {
    console.warn(`ChainId ${chainId} is not mapped or supported by Moralis param`);
    return [];
  }

  let allTxs: any[] = [];
  let cursor = "";
  let page = 0;

  while (true) {

    const url = new URL(`https://deep-index.moralis.io/api/v2.2/${address}`);
    url.searchParams.set("chain", chainParam);
    url.searchParams.set("order", "DESC");
    url.searchParams.set("from_date", fromDate);
    url.searchParams.set("to_date", toDate);

    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const resp = await fetch(url.toString(), {
      headers: {
        "X-API-Key": moralisApiKey,
        "accept": "application/json",
      },
    });

    if (!resp.ok) {
      logAndPersistLogUpdate(
        `Moralis request failed (chainId=${chainId}): ${resp.status} ${resp.statusText}`,
      );
      break;
    }

    const data = await resp.json();
    if (!data.result || !Array.isArray(data.result) || data.result.length === 0) {
      // No more transactions to page through
      break;
    }

    // Add them to our array
    // Attach chainId manually 
    for (const tx of data.result) {
      tx.chainId = chainId;
    }
    allTxs.push(...data.result);

    // If Moralis provides a next cursor, use it
    // If there's no cursor, we've fetched everything
    if (data.cursor) {
      cursor = data.cursor;
    } else {
      break;
    }

    page++;
  }

  return allTxs;
}

async function getLast24HoursTxs(ourAddress: string) {
  const chainIds = Object.keys(chainIdToMoralisChainParam).map(Number);

  // Build date range for the last 24 hours
  // Moralis typically accepts YYYY-MM-DD or full ISO date strings
  const now = new Date();
  const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const toDate = now.toISOString();

  const txsByChain: Record<number, any[]> = {};
  const allTxs: any[] = [];

  for (const chainId of chainIds) {
    try {
      const chainTxs = await fetchMoralisTxsForChain({
        address: ourAddress,
        chainId,
        fromDate,
        toDate,
      });
      txsByChain[chainId] = chainTxs;
      allTxs.push(...chainTxs);
      logAndPersistLogUpdate(
        `Fetched ${chainTxs.length} txs on chain ${chainId} from Moralis in last 24 hrs.`,
      );
    } catch (err) {
      logAndPersistLogUpdate(`Error fetching chain ${chainId}:`, err);
      txsByChain[chainId] = [];
    }
  }

  // // aurora
  // const auroraTxs = await getLast24HoursOfAuroraTransactions(ourAddress);
  // logAndPersistLogUpdate(
  //   `Fetched ${auroraTxs.length} txs on chain 1313161554 from Aurora in last 24 hrs.`,
  // );
  // txsByChain[1313161554] = auroraTxs;
  // allTxs.push(...auroraTxs);

  return { allTxs, txsByChain };

}



async function processIdServerTransactions() {
  const ourAddress = "0xdcA2e9AE8423D7B0F94D7F9FC09E698a45F3c851".toLowerCase();
  // logAndPersistLogUpdate('getting transaction hashes')
  // const transactionHashesByChain =
  //   await getTransactionsHashesByChainLast48Hrs(ourAddress);

  logAndPersistLogUpdate("Fetching transactions from Moralis for last 24 hours...");
  const { allTxs, txsByChain } = await getLast24HoursTxs(ourAddress);
  logAndPersistLogUpdate("Total TXs across all chains:", allTxs.length);

  logAndPersistLogUpdate('getting sessions')
  
  //get all sessions within last 24 hours
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const objectId = new ObjectId(Math.floor(twentyFourHoursAgo.getTime() / 1000).toString(16) + "0000000000000000");
  const allSessions = await Session.find({
    _id: {
      $gte: objectId
    }
  }).exec();

  logAndPersistLogUpdate('allSessions.length', allSessions.length)

  logAndPersistLogUpdate('processing transactions against id-server sessions')

  for (let i = 0; i < allTxs.length; i++) {
    logUpdate(`i ${i}`)
    const tx = allTxs[i]

    // Print progress at 10% intervals
    if (i % (allTxs.length / 10) === 0) {
      logAndPersistLogUpdate(`Processing transaction ${i} of ${allTxs.length}`);
    }

    const txHash = tx.hash
    const chainId = tx.chainId
    if (await isProcessedForIdServer(txHash)) {
      continue;
    }

    for (let session of allSessions) {
      const digest = ethers.utils.keccak256("0x" + session._id);

      if (tx.to_address !== ourAddress || tx.input !== digest) {
        continue;
      }

      // If the session is already associated with some other transaction, and if
      // this transaction's data matches this session ID, then we know that this transaction
      // was a retry and should be refunded.
      if (session.txHash && (session.txHash.toLowerCase() !== tx.hash.toLowerCase())) {
        logAndPersistLogUpdate(`REFUNDING: Refunding transaction ${txHash} on chain ${chainId} for session ${session}`);
        const resp = await idServerAdmin.refundUnusedTransaction(tx.hash, tx.chainId, tx.from_address)
        logAndPersistLogUpdate('refund response', resp.data)

        await setProcessedForIdServer(txHash);
      }

      if (session.status === sessionStatusEnum.NEEDS_PAYMENT) {
        logAndPersistLogUpdate(`SET IN_PROGRESS: Using transaction ${txHash} on chain ${chainId} for session ${session}`);
        await idServerAdmin.createIDVSession(session._id.toString(), txHash, chainId)

        await setProcessedForIdServer(txHash);
      }
    }
  }
}

async function processPhoneServerTransactions() {
  const ourAddress = "0xdcA2e9AE8423D7B0F94D7F9FC09E698a45F3c851".toLowerCase();

  logAndPersistLogUpdate("Fetching transactions from Moralis for last 24 hours...");
  const { allTxs, txsByChain } = await getLast24HoursTxs(ourAddress);
  // const allTxs = [{hash: '0x123', chainId: 1, to_address: '0x123', input: '0x123', from_address: '0x123'}] // for testing
  logAndPersistLogUpdate("Total TXs across all chains:", allTxs.length);

  logAndPersistLogUpdate("Getting phone sessions")

  const phoneSessions = await getAllPhoneSessions()

  logAndPersistLogUpdate('phoneSessions.length', phoneSessions.length)

  logAndPersistLogUpdate('processing transactions against phone-number-server sessions')

  for (let i = 0; i < allTxs.length; i++) {
    logUpdate(`i ${i}`)
    const tx = allTxs[i]

    // Print progress at 10% intervals
    if (i % (allTxs.length / 10) === 0) {
      logAndPersistLogUpdate(`Processing transaction ${i} of ${allTxs.length}`);
    }

    const txHash = tx.hash
    const chainId = tx.chainId
    if (await isProcessedForPhoneServer(txHash)) {
      continue;
    }

    for (const session of phoneSessions) {
      try {
        // Really old phone sessions have session IDs that start with 0x. We don't
        // care about those, so we filter those out.
        if (session.id.startsWith('0x')) {
          continue
        }

        let digest = null
        try {
          digest = ethers.utils.keccak256("0x" + session.id);
        } catch (err) {
          logAndPersistLogUpdate(`error hashing session id for session ${JSON.stringify(session)}... ${(err as any).message}`)
          continue;
        }

        if (tx.to_address !== ourAddress || tx.input !== digest) {
          continue;
        }

        // If the session is already associated with some other transaction, and if
        // this transaction's data matches this session ID, then we know that this transaction
        // was a retry and should be refunded.
        if (session.txHash && (session.txHash.toLowerCase() !== tx.hash.toLowerCase())) {
          logAndPersistLogUpdate(`(phone) REFUNDING: Refunding transaction ${txHash} on chain ${chainId} for session ${session}`);
          // TODO: Update this. Call endpoint in phone server instead
          const resp = await idServerAdmin.refundUnusedTransaction(tx.hash, tx.chainId, tx.from_address)
          logAndPersistLogUpdate('refund response', resp.data)

          await setProcessedForPhoneServer(txHash);
        }

        if (session.sessionStatus === sessionStatusEnum.NEEDS_PAYMENT) {
          logAndPersistLogUpdate(`(phone) SET IN_PROGRESS: Using transaction ${txHash} on chain ${chainId} for session ${session}`);
          await phoneServerAdmin.payForSession(session.id.toString(), txHash, chainId)

          await setProcessedForPhoneServer(txHash);
        }
      } catch (err) {
        console.log(`encountered error for session ${JSON.stringify(session)}`, err)
      }
    }
  }
}

const command = process.argv[2]

if (command === 'id-server') {
  processIdServerTransactions()
    .then(() => {
      logAndPersistLogUpdate('done')
      process.exit(0)
    })
    .catch((err) => {
      logAndPersistLogUpdate(err)
      process.exit(1)
    })  
} else if (command === 'phone-number-server') {
  processPhoneServerTransactions()
    .then(() => {
      logAndPersistLogUpdate('done')
      process.exit(0)
    })
    .catch((err) => {
      logAndPersistLogUpdate(err)
      process.exit(1)
    })
} else {
  console.log(`unknown command "${command}`)
  process.exit(1)
}
