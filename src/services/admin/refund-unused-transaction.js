import { ObjectId } from "mongodb";
import { ethers } from "ethers";
import { Session } from "../../init.js";
import {
  idServerPaymentAddress,
  sessionStatusEnum,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  supportedChainIds,
} from "../../constants/misc.js";
import logger from "../../utils/logger.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";

const postEndpointLogger = logger.child({
  msgPrefix: "[POST /admin/refund-unused-transaction] ",
});

export async function refundUnusedTransaction(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const txHash = req.body.txHash;
    const chainId = Number(req.body.chainId);
    const to = req.body.to;

    if (!txHash) {
      return res.status(400).json({ error: "No txHash specified." });
    }

    if (!chainId) {
      return res.status(400).json({ error: "No chainId specified." });
    }

    if (supportedChainIds.indexOf(chainId) === -1) {
      return res.status(400).json({
        error: `chainId must be one of ${supportedChainIds.join(", ")}`,
      });
    }

    if (!to) {
      return res.status(400).json({ error: "No 'to' specified." });
    }

    const session = await Session.findOne({ txHash }).exec();

    if (session) {
      return res.status(404).json({
        error: `Transaction ${txHash} is already associated with a session.`,
      });
    }

    // ------------ begin tx validation ------------
    let provider;
    if (chainId === 1) {
      provider = ethereumProvider;
    } else if (chainId === 10) {
      provider = optimismProvider;
    } else if (chainId === 250) {
      provider = fantomProvider;
    } else if (chainId === 43114) {
      provider = avalancheProvider;
    } else if (process.env.NODE_ENV === "development" && chainId === 420) {
      provider = optimismGoerliProvider;
    }

    const tx = await provider.getTransaction(txHash);

    if (!tx) {
      return res.status(404).json({
        error: `Could not find ${txHash} on chain ${chainId}.`,
      });
    }

    if (idServerPaymentAddress !== tx.to.toLowerCase()) {
      return res.status(400).json({
        error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`,
      });
    }

    // We check that the tx.value is greater than $6. This is a bit of a hack.
    // Phone verification costs $5, and ID verification costs $10. So, if tx.value
    // is greater than $6, we can be reasonably confident that the user is trying
    // to get a refund for ID verification.
    const expectedAmountInUSD = 6.0;

    let expectedAmountInToken;
    if ([1, 10].includes(chainId)) {
      expectedAmountInToken = await usdToETH(expectedAmountInUSD);
    } else if (chainId === 250) {
      expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
    } else if (chainId === 43114) {
      expectedAmountInToken = await usdToAVAX(expectedAmountInUSD);
    } else if (process.env.NODE_ENV === "development" && chainId === 420) {
      expectedAmountInToken = await usdToETH(expectedAmountInUSD);
    }

    if (!tx.blockHash || tx.confirmations === 0) {
      return res.status(400).json({
        error: "Transaction has not been confirmed yet.",
      });
    }

    // Round to 18 decimal places to avoid this underflow error from ethers:
    // "fractional component exceeds decimals"
    const decimals = 18;
    const multiplier = 10 ** decimals;
    const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

    const expectedAmount = ethers.utils.parseEther(rounded.toString());

    if (tx.value.lt(expectedAmount)) {
      return res.status(400).json({
        error: `Invalid transaction amount. Expected it to be greater than: ${expectedAmount.toString()}. Found: ${tx.value.toString()}. (chain ID: ${chainId})`,
      });
    }

    // ------------ end tx validation ------------

    const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY, provider);

    // Send 90% of tx.value back to sender. We keep some to cover gas
    const refundAmount = tx.value.mul(9).div(10);

    // Ensure wallet has enough funds to refund
    const balance = await wallet.getBalance();
    if (balance.lt(refundAmount)) {
      return res.status(500).json({
        error: "Wallet does not have enough funds to issue refund.",
      });
    }

    const txReq = await wallet.populateTransaction({
      to: to,
      value: refundAmount,
    });

    // For some reason gas estimates from Fantom are way off. We manually increase
    // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
    // in the future. The following values happened to be sufficient at the time
    // of adding this block.
    if (chainId === 250) {
      txReq.maxFeePerGas = txReq.maxFeePerGas.mul(2);
      txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);
    }

    const txResponse = await wallet.sendTransaction(txReq);

    await txResponse.wait();

    // create new session to ensure this transaction cannot be used again
    const newSession = new Session({
      sigDigest: "n/a",
      idvProvider: "n/a",
      status: sessionStatusEnum.REFUNDED,
      txHash,
      chainId,
      refundTxHash: txResponse.hash,
    });
    await newSession.save();

    return res.status(200).json({
      message: `Successfully refunded user ${to} for transaction ${txHash} on chain ${chainId}.`,
      refundTxHash: txResponse.hash,
    });
  } catch (err) {
    postEndpointLogger.error({ error: err, errMsg: err.message });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}
