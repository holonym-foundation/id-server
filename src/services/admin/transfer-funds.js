import { ethers } from "ethers";
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
  horizonServer,
  krakenXLMAddress,
  krakenXLMMemo,
} from "../../constants/misc.js";
import { pinoOptions, logger } from "../../utils/logger.js";

// const endpointLogger = logger.child({
//   msgPrefix: "[DELETE /admin/transfer-funds] ",
//   base: {
//     ...pinoOptions.base,
//   },
// });

/**
 * Endpoint to be called by daemon to periodically transfer funds from
 * id-server's account to the company's account.
 */
async function transferFunds(req, res) {
  const apiKey = req.headers["x-api-key"];

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Invalid API key." });
  }

  const txReceipts = {};

  try {
    const mainnetWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY,
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
      process.env.PAYMENTS_PRIVATE_KEY,
      optimismProvider
    );
    const balanceOptimism = await optimismWallet.getBalance();
    // If balance is less than 0.2 ETH, don't transfer. Otherwise, send 0.15 ETH.
    // We keep some ETH to pay for refunds.
    if (balanceOptimism.gte(ethers.utils.parseEther("0.2"))) {
      const tx = await optimismWallet.sendTransaction({
        to: companyAddressOP,
        value: ethers.utils.parseEther("0.15"),
      });

      txReceipts["optimism"] = await tx.wait();
    }

    // Transfer FTM on Fantom \\
    const fantomWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY,
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

      txReq.maxFeePerGas = txReq.maxFeePerGas.mul(4);
      txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);

      if (txReq.maxPriorityFeePerGas.gt(txReq.maxFeePerGas)) {
        txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
      }

      const tx = await fantomWallet.sendTransaction(txReq);

      txReceipts["fantom"] = await tx.wait();
    }

    // Transfer ETH on Base \\
    const baseWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY,
      baseProvider
    );
    const balanceBase = await baseWallet.getBalance();
    // If balance is less than 0.2 ETH, don't transfer. Otherwise, send 0.15 ETH.
    // We keep some ETH to pay for refunds.
    if (balanceBase.gte(ethers.utils.parseEther("0.4"))) {
      const tx = await baseWallet.sendTransaction({
        to: companyAddressBase,
        value: ethers.utils.parseEther("0.15"),
      });

      txReceipts["base"] = await tx.wait();
    }

    // Transfer AVAX on Avalanche \\
    const avalancheWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY,
      avalancheProvider
    );
    const balanceAvalanche = await avalancheWallet.getBalance();
    // If balance is less than 20 AVAX, don't transfer. Otherwise, send 15 AVAX.
    // We keep some AVAX to pay for refunds.
    if (balanceAvalanche.gte(ethers.utils.parseEther("20"))) {
      const tx = await avalancheWallet.sendTransaction({
        to: companyAddressAVAX,
        value: ethers.utils.parseEther("15"),
      });

      txReceipts["avalanche"] = await tx.wait();
    }

    // Transfer ETH on Aurora \\
    const auroraWallet = new ethers.Wallet(
      process.env.PAYMENTS_PRIVATE_KEY,
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

    // Transfer ETH on Stellar \\
    const stellarKeypair = StellarSdk.Keypair.fromSecret(
      process.env.STELLAR_PAYMENTS_SECRET_KEY
    );
    const stellarAccount = await horizonServer.loadAccount(stellarKeypair.publicKey());
    const xlmBalance = stellarAccount.balances.filter(x => x.asset_type === 'native')[0].balance;
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
        amount: '1700',
        asset: StellarSdk.Asset.native()
      }))
      .setTimeout(180)
      .build();
      stellarTx.sign(stellarKeypair);

      const tx = await horizonServer.submitTransaction(stellarTx);
      txReceipts["stellar"] = tx.hash;
    }

    return res.status(200).json(txReceipts);
  } catch (err) {
    console.log("transferFunds: Error encountered (a)", err.message);
    if (err?.response?.data)
      console.log("transferFunds: Error encountered (b)", err?.response?.data);
    else console.log("transferFunds: Error encountered (b)", err);
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { transferFunds };
