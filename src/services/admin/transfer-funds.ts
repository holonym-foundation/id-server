import { Request, Response } from "express";
import { ethers } from "ethers";
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction as SuiTransaction } from '@mysten/sui/transactions';
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  ethereumProvider,
  optimismProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
  companyENS,
  companyAddressOP,
  companyAddressFTM,
  companyAddressAVAX,
  companyAddressBase,
  companyAddressAurora,
  horizonServer,
  krakenXLMAddress,
  krakenXLMMemo,
  suiClient,
  companySuiAddress,
  humanIDPaymentsContractAddresses,
  humanIDPaymentsABI,
} from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";
import { mistToSui, suiToMist } from "../../utils/sui.js";
import { postNotification } from "../../utils/slack.js";
import { getProvider } from "../../utils/misc.js";

// const endpointLogger = logger.child({
//   msgPrefix: "[DELETE /admin/transfer-funds] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

/**
 * Company addresses for each chain
 */
const companyAddressByChain: Record<number, string> = {
  1: companyENS, // Ethereum
  10: companyAddressOP, // Optimism
  250: companyAddressFTM, // Fantom
  8453: companyAddressBase, // Base
  43114: companyAddressAVAX, // Avalanche
  1313161554: companyAddressAurora, // Aurora
  11155420: companyAddressOP, // Optimism Sepolia (use same as Optimism)
  420: companyAddressOP, // Optimism Goerli (use same as Optimism)
};

/**
 * Withdraw funds from HumanIDPayments contracts across all chains
 */
async function withdrawFromPaymentContracts(
  txReceipts: Record<string, any>
): Promise<void> {
  const adminWallet = new ethers.Wallet(process.env.PAYMENTS_ADMIN_PRIVATE_KEY as string);

  for (const [chainIdStr, contractAddress] of Object.entries(humanIDPaymentsContractAddresses)) {
    const chainId = parseInt(chainIdStr);

    // Skip if contract address is not set
    if (!contractAddress) {
      continue;
    }

    try {
      const provider = getProvider(chainId);
      const connectedWallet = adminWallet.connect(provider);
      const contract = new ethers.Contract(
        contractAddress,
        humanIDPaymentsABI,
        connectedWallet
      );

      // Get contract balance
      const balance = await contract.getBalance();

      // Define minimum balance thresholds (in ETH/native token)
      const minBalance = chainId === 250
        ? ethers.utils.parseEther("1000") // Fantom: 1000 FTM
        : chainId === 43114
        ? ethers.utils.parseEther("20") // Avalanche: 20 AVAX
        : ethers.utils.parseEther("0.1"); // Other chains: 0.1 ETH

      if (balance.gte(minBalance)) {
        // First, if admin wallet is running low on funds (which it needs for gas), withdraw
        // from the contract to the admin wallet.
        const adminBalance = await connectedWallet.getBalance();
        const expectedAdminBalance = minBalance.div(ethers.utils.parseEther("50"));
        if (adminBalance.lt(expectedAdminBalance)) {
          const tx = await contract.withdrawTo(expectedAdminBalance, connectedWallet.address);
          const receipt = await tx.wait();
          txReceipts[`${getChainName(chainId)}_admin_wallet`] = receipt;
          console.log(`Withdrew ${ethers.utils.formatEther(expectedAdminBalance)} from ${getChainName(chainId)} payment contract to admin wallet`);
        }

        const companyAddress = companyAddressByChain[chainId];

        // Withdraw only the amount above the refund threshold, leaving minBalance in contract for refunds
        const withdrawAmount = balance.sub(minBalance).sub(expectedAdminBalance);
        if (withdrawAmount.gt(0)) {
          const tx = await contract.withdrawTo(withdrawAmount, companyAddress);
          const receipt = await tx.wait();

          const chainName = getChainName(chainId);
          txReceipts[`${chainName}_payment_contract`] = receipt;

          console.log(`Withdrew ${ethers.utils.formatEther(balance)} from ${chainName} payment contract`);
        }
      }
    } catch (err) {
      console.error(`Error withdrawing from payment contract on chain ${chainId}:`, err);
      // Continue with other chains even if one fails
      // TODO: Alert slack if wallet doesn't have sufficient balance to pay for the withdraw transaction
    }
  }
}

/**
 * Get human-readable chain name
 */
function getChainName(chainId: number): string {
  const chainNames: Record<number, string> = {
    1: "ethereum",
    10: "optimism",
    250: "fantom",
    8453: "base",
    43114: "avalanche",
    1313161554: "aurora",
    11155420: "optimism_sepolia",
    420: "optimism_goerli",
  };
  return chainNames[chainId] || `chain_${chainId}`;
}

/**
 * Endpoint to be called by daemon to periodically transfer funds from
 * id-server's account to the company's account.
 */
async function transferFunds(req: Request, res: Response) {
  const apiKey = req.headers["x-api-key"];

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  const txReceipts: Record<string, any> = {};

  try {
    const mainnetWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      ethereumProvider
    );
    const balanceMainnet = await mainnetWallet.getBalance();
    // If balance is less than 0.3 ETH, don't transfer. Otherwise, send 0.25 ETH.
    // We keep some ETH to pay for refunds.
    if (balanceMainnet.gte(ethers.utils.parseEther("0.3"))) {
      const tx = await mainnetWallet.sendTransaction({
        to: companyENS,
        value: ethers.utils.parseEther("0.25"),
      });

      txReceipts["ethereum"] = await tx.wait();
    }

    // Transfer ETH on Optimism \\
    const optimismWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      optimismProvider
    );
    const balanceOptimism = await optimismWallet.getBalance();
    // If balance is less than 0.2 ETH, don't transfer. Otherwise, send (balance - 0.05) ETH.
    if (balanceOptimism.gte(ethers.utils.parseEther("0.2"))) {
      const tx = await optimismWallet.sendTransaction({
        to: companyAddressOP,
        value: balanceOptimism.sub(ethers.utils.parseEther("0.05")),
      });

      txReceipts["optimism"] = await tx.wait();
    }

    // Transfer FTM on Fantom \\
    const fantomWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      fantomProvider
    );
    const balanceFantom = await fantomWallet.getBalance();

    // If balance is less than 1.3k FTM, don't transfer. Otherwise, send 1k FTM.
    // We keep some FTM to pay for refunds.
    if (balanceFantom.gte(ethers.utils.parseEther("1300"))) {
      const txReq = await fantomWallet.populateTransaction({
        to: companyAddressFTM,
        value: ethers.utils.parseEther("1100"),
      });

      txReq.maxFeePerGas = (txReq.maxFeePerGas as any).mul(4);
      txReq.maxPriorityFeePerGas = (txReq.maxPriorityFeePerGas as any).mul(14);

      if ((txReq.maxPriorityFeePerGas as any).gt(txReq.maxFeePerGas)) {
        txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
      }

      const tx = await fantomWallet.sendTransaction(txReq);

      txReceipts["fantom"] = await tx.wait();
    }

    // Transfer ETH on Base \\
    const baseWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      baseProvider
    );
    const balanceBase = await baseWallet.getBalance();
    // If balance is less than 0.2 ETH, don't transfer. Otherwise, send (balance - 0.05) ETH.
    // We keep some ETH to pay for refunds.
    if (balanceBase.gte(ethers.utils.parseEther("0.4"))) {
      const tx = await baseWallet.sendTransaction({
        to: companyAddressBase,
        value: balanceBase.sub(ethers.utils.parseEther("0.05")),
      });

      txReceipts["base"] = await tx.wait();
    }

    // Transfer AVAX on Avalanche \\
    const avalancheWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      avalancheProvider
    );
    const balanceAvalanche = await avalancheWallet.getBalance();
    // If balance is less than 20 AVAX, don't transfer. Otherwise, send (balance - 5) AVAX.
    // We keep some AVAX to pay for refunds.
    if (balanceAvalanche.gte(ethers.utils.parseEther("20"))) {
      const tx = await avalancheWallet.sendTransaction({
        to: companyAddressAVAX,
        value: balanceAvalanche.sub(ethers.utils.parseEther("5")),
      });

      txReceipts["avalanche"] = await tx.wait();
    }

    // Transfer ETH on Aurora \\
    const auroraWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY as string,
      auroraProvider
    );
    const balanceAurora = await auroraWallet.getBalance();
    // If balance is less than 0.2 ETH, don't transfer. Otherwise, send 0.15 ETH.
    // We keep some ETH to pay for refunds.
    if (balanceAurora.gte(ethers.utils.parseEther("0.2"))) {
      const tx = await auroraWallet.sendTransaction({
        to: companyAddressAVAX,
        value: ethers.utils.parseEther("0.15"),
      });

      txReceipts["aurora"] = await tx.wait();
    }

    // Transfer XLM on Stellar \\
    const stellarKeypair = StellarSdk.Keypair.fromSecret(
      process.env.STELLAR_PAYMENTS_SECRET_KEY as string
    );
    const stellarAccount = await horizonServer.loadAccount(stellarKeypair.publicKey());
    const xlmBalance: number = parseFloat(stellarAccount.balances.filter(x => x.asset_type === 'native')[0].balance);
    if (xlmBalance >= 2000) {
      const stellarTx = new StellarSdk.TransactionBuilder(
        stellarAccount,
        {
          memo: krakenXLMMemo,
          networkPassphrase: StellarSdk.Networks.PUBLIC,
          fee: '100'
        }
      )
      .addOperation(StellarSdk.Operation.payment({
        destination: krakenXLMAddress,
        amount: (xlmBalance - 300).toString(),
        asset: StellarSdk.Asset.native()
      }))
      .setTimeout(180)
      .build();
      stellarTx.sign(stellarKeypair);

      const tx = await horizonServer.submitTransaction(stellarTx);
      txReceipts["stellar"] = tx.hash;
    }

    // Transfer SUI on Sui \\
    try {
      const privateKeyBytes = new Uint8Array(
        Buffer.from((process.env.SUI_PRIVATE_KEY as string).replace('0x', ''), 'hex')
      );
      const suiWallet = Ed25519Keypair.fromSecretKey(privateKeyBytes);
      const suiBalanceResult = await suiClient.getBalance({
        owner: suiWallet.toSuiAddress()
      })
      const suiBalance: number = mistToSui(Number(suiBalanceResult?.totalBalance as string))
      if (suiBalance > 150) {
        // Send all but 30 SUI to company address
        const amountToSend: number = Math.floor(suiToMist(suiBalance - 30));
        const tx = new SuiTransaction();

        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountToSend)]);
        tx.transferObjects([coin], tx.pure.address(companySuiAddress));

        const result = await suiClient.signAndExecuteTransaction({
          signer: suiWallet,
          transaction: tx,
          options: {
            showEvents: true,
            showEffects: true,
          }
        });

        console.log(`Transfered ${mistToSui(amountToSend)} SUI to ${companySuiAddress}. Result:`, result)
        txReceipts["sui"] = result.digest
      }
    } catch (err) {
      console.error('error trying to transfer sui funds', err)
    }

    // Withdraw funds from HumanIDPayments contracts \\
    await withdrawFromPaymentContracts(txReceipts);

    await notifySlack(txReceipts)

    return res.status(200).json(txReceipts);
  } catch (err) {
    console.log("transferFunds: Error encountered (a)", (err as Error).message);
    if ((err as any)?.response?.data)
      console.log("transferFunds: Error encountered (b)", (err as any)?.response?.data);
    else console.log("transferFunds: Error encountered (b)", err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

async function notifySlack(txReceipts: Record<string, any>) {
  try {
    const txLinks: Record<string, string> = {}
    if (txReceipts.ethereum) {
      txLinks['Ethereum'] = `https://etherscan.io/tx/${txReceipts.ethereum.transactionHash}`
    }
    if (txReceipts.optimism) {
      txLinks['Optimism'] = `https://optimistic.etherscan.io/tx/${txReceipts.optimism.transactionHash}`
    }
    // if (txReceipts.fantom) {
    //   txLinks['fantom'] = txReceipts.fantom
    // }
    if (txReceipts.base) {
      txLinks['Base'] = `https://basescan.org/tx/${txReceipts.base.transactionHash}`
    }
    if (txReceipts.avalanche) {
      txLinks['Avalanche'] = `https://basescan.org/tx/${txReceipts.avalanche.transactionHash}`
    }
    // if (txReceipts.aurora) {
    //   txLinks['aurora'] = txReceipts.aurora
    // }
    if (txReceipts.stellar) {
      txLinks['Stellar'] = `https://lumenscan.io/txns/${txReceipts.stellar}`
    }
    if (txReceipts.sui) {
      txLinks['Sui'] = `https://suivision.xyz/txblock/${txReceipts.sui}`
    }

    // Payment contract withdrawals
    if (txReceipts.ethereum_payment_contract) {
      txLinks['Ethereum Payment Contract'] = `https://etherscan.io/tx/${txReceipts.ethereum_payment_contract.transactionHash}`
    }
    if (txReceipts.optimism_payment_contract) {
      txLinks['Optimism Payment Contract'] = `https://optimistic.etherscan.io/tx/${txReceipts.optimism_payment_contract.transactionHash}`
    }
    if (txReceipts.fantom_payment_contract) {
      txLinks['Fantom Payment Contract'] = `https://ftmscan.com/tx/${txReceipts.fantom_payment_contract.transactionHash}`
    }
    if (txReceipts.base_payment_contract) {
      txLinks['Base Payment Contract'] = `https://basescan.org/tx/${txReceipts.base_payment_contract.transactionHash}`
    }
    if (txReceipts.avalanche_payment_contract) {
      txLinks['Avalanche Payment Contract'] = `https://snowtrace.io/tx/${txReceipts.avalanche_payment_contract.transactionHash}`
    }
    if (txReceipts.aurora_payment_contract) {
      txLinks['Aurora Payment Contract'] = `https://explorer.aurora.dev/tx/${txReceipts.aurora_payment_contract.transactionHash}`
    }
    if (txReceipts.optimism_sepolia_payment_contract) {
      txLinks['Optimism Sepolia Payment Contract'] = `https://sepolia-optimism.etherscan.io/tx/${txReceipts.optimism_sepolia_payment_contract.transactionHash}`
    }

    const linksBulletPoints = Object.entries(txLinks)
      .map(([chain, url]) => `• ${chain}: <${url}|${txLinks[chain]}>`)
      .join('\n')
    if (Object.entries(txLinks).length > 0) {
      console.log('transfer-funds: sending slack notification')
      await postNotification({
        webhookURL: process.env.SLACK_WEBHOOK as string,
        message: `id-server transferred funds from hot wallets to company cold wallets.\n\n${linksBulletPoints}`
      })
    }
  } catch (err) {
    console.log('error trying to assemble slack message', err)
  }
}

export { transferFunds };
