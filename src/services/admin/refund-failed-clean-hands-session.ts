import { Request, Response } from "express";
import { HydratedDocument } from "mongoose";
import { ObjectId } from "mongodb";
import { ethers } from "ethers";
import { AMLChecksSession, SessionRefundMutex } from "../../init.js";
import {
  idServerPaymentAddress,
  sessionStatusEnum,
  ethereumProvider,
  optimismProvider,
  optimismGoerliProvider,
  fantomProvider,
  avalancheProvider,
  auroraProvider,
  baseProvider,
  supportedChainIds,
} from "../../constants/misc.js";
import { IAmlChecksSession, ISessionRefundMutex } from "../../types.js";
import logger from "../../utils/logger.js";
import { refundMintFeeOnChain } from "../../utils/transactions.js";
import { usdToETH, usdToFTM, usdToAVAX } from "../../utils/cmc.js";

const postEndpointLogger = logger.child({
  msgPrefix: "[POST /admin/refund-failed-clean-hands-session] ",
});


/**
 * Given a transaction hash and chainId, refund the transaction to the sender
 * of the transaction iff the transaction is associated with a failed session.
 * Useful for cases where the user is using a wallet with non-deterministic
 * signatures and so cannot get access to their original sigDigest and thus
 * cannot get access to their original sessions.
 */
export async function refundFailedCleanHandsSession(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const txHash: string = req.body.txHash;

    if (!txHash) {
      return res.status(400).json({ error: "No txHash specified." });
    }

    const session: HydratedDocument<IAmlChecksSession> | null = await AMLChecksSession.findOne({ txHash }).exec();

    if (session?.status !== sessionStatusEnum.VERIFICATION_FAILED) {
      return res.status(400).json({
        error: `Transaction ${txHash} is not associated with a failed session.`,
      });
    }

    // ------------ begin tx validation ------------
    let provider;
    if (session.chainId === 1) {
      provider = ethereumProvider;
    } else if (session.chainId === 10) {
      provider = optimismProvider;
    } else if (session.chainId === 250) {
      provider = fantomProvider;
    } else if (session.chainId === 8453) {
      provider = baseProvider;
    } else if (session.chainId === 43114) {
      provider = avalancheProvider;
    } else if (session.chainId === 1313161554) {
      provider = auroraProvider;
    } else if (process.env.NODE_ENV === "development" && session.chainId === 420) {
      provider = optimismGoerliProvider;
    } else {
      throw new Error(`Unexpected: Session has unsupported chain ID: ${session.chainId}`);
    }

    const tx = await provider.getTransaction(txHash);

    if (!tx) {
      return res.status(404).json({
        error: `Could not find ${txHash} on chain ${session.chainId}.`,
      });
    }

    if (idServerPaymentAddress !== (tx.to as string).toLowerCase()) {
      return res.status(400).json({
        error: `Invalid transaction recipient. Recipient must be ${idServerPaymentAddress}`,
      });
    }

    if (!tx.blockHash || tx.confirmations === 0) {
      return res.status(400).json({
        error: "Transaction has not been confirmed yet.",
      });
    }

    const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY as string, provider);

    const refundAmount = tx.value //.mul(8).div(10);

    // Ensure wallet has enough funds to refund
    const balance = await wallet.getBalance();
    if (balance.lt(refundAmount)) {
      return {
        status: 500,
        data: {
          error: "Wallet does not have enough funds to refund. Please contact support.",
        },
      };
    }

    const txReq = await wallet.populateTransaction({
      to: tx.from,
      value: refundAmount,
    });

    // For some reason gas estimates from Fantom are way off. We manually increase
    // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
    // in the future. The following values happened to be sufficient at the time
    // of adding this block.
    if (session.chainId === 250) {
      txReq.maxFeePerGas = (txReq.maxFeePerGas as any).mul(2);
      txReq.maxPriorityFeePerGas = (txReq.maxPriorityFeePerGas as any).mul(14);

      if ((txReq.maxPriorityFeePerGas as any).gt(txReq.maxFeePerGas)) {
        txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
      }
    }

    const mutex: HydratedDocument<ISessionRefundMutex> | null = await SessionRefundMutex.findOne({ _id: session._id }).exec();
    if (mutex) {
      return res.status(400).json({ error: "Refund already in progress" });
    }
    const newMutex = new SessionRefundMutex({ _id: session._id });
    await newMutex.save();

    const txResponse = await wallet.sendTransaction(txReq);

    // Delete mutex
    await SessionRefundMutex.deleteOne({ _id: session._id }).exec();

    const receipt = await txResponse.wait();

    session.refundTxHash = receipt.transactionHash;
    session.status = sessionStatusEnum.REFUNDED;
    await session.save();

    return res.status(200).json({
      message: `Successfully refunded user ${tx.from} for transaction ${txHash} on chain ${session.chainId}.`,
      refundTxHash: txResponse.hash,
    });

    // =----------------------=----------------------

    // // We check that the tx.value is greater than $6. This is a bit of a hack.
    // // Phone verification costs $5, and ID verification costs $10. So, if tx.value
    // // is greater than $6, we can be reasonably confident that the user is trying
    // // to get a refund for ID verification.
    // const expectedAmountInUSD = 6.0;

    // let expectedAmountInToken;
    // if ([1, 10, 1313161554].includes(chainId)) {
    //   expectedAmountInToken = await usdToETH(expectedAmountInUSD);
    // } else if (chainId === 250) {
    //   expectedAmountInToken = await usdToFTM(expectedAmountInUSD);
    // } else if (chainId === 43114) {
    //   expectedAmountInToken = await usdToAVAX(expectedAmountInUSD);
    // } else if (process.env.NODE_ENV === "development" && chainId === 420) {
    //   expectedAmountInToken = await usdToETH(expectedAmountInUSD);
    // }

    // if (!tx.blockHash || tx.confirmations === 0) {
    //   return res.status(400).json({
    //     error: "Transaction has not been confirmed yet.",
    //   });
    // }

    // // Round to 18 decimal places to avoid this underflow error from ethers:
    // // "fractional component exceeds decimals"
    // const decimals = 18;
    // const multiplier = 10 ** decimals;
    // const rounded = Math.round(expectedAmountInToken * multiplier) / multiplier;

    // const expectedAmount = ethers.utils.parseEther(rounded.toString());

    // // if (tx.value.lt(expectedAmount)) {
    // //   return res.status(400).json({
    // //     error: `Invalid transaction amount. Expected it to be greater than: ${expectedAmount.toString()}. Found: ${tx.value.toString()}. (chain ID: ${chainId})`,
    // //   });
    // // }

    // // ------------ end tx validation ------------

    // const wallet = new ethers.Wallet(process.env.PAYMENTS_PRIVATE_KEY, provider);

    // // Send 90% of tx.value back to sender. We keep some to cover gas
    // const refundAmount = tx.value.mul(9).div(10);

    // // Ensure wallet has enough funds to refund
    // const balance = await wallet.getBalance();
    // if (balance.lt(refundAmount)) {
    //   return res.status(500).json({
    //     error: "Wallet does not have enough funds to issue refund.",
    //   });
    // }

    // const txReq = await wallet.populateTransaction({
    //   to: to,
    //   value: refundAmount,
    // });

    // // For some reason gas estimates from Fantom are way off. We manually increase
    // // gas to avoid "transaction underpriced" error. Hopefully this is unnecessary
    // // in the future. The following values happened to be sufficient at the time
    // // of adding this block.
    // if (chainId === 250) {
    //   txReq.maxFeePerGas = txReq.maxFeePerGas.mul(2);
    //   txReq.maxPriorityFeePerGas = txReq.maxPriorityFeePerGas.mul(14);

    //   if (txReq.maxPriorityFeePerGas.gt(txReq.maxFeePerGas)) {
    //     txReq.maxPriorityFeePerGas = txReq.maxFeePerGas;
    //   }
    // }

    // const txResponse = await wallet.sendTransaction(txReq);

    // await txResponse.wait();

    // // create new session to ensure this transaction cannot be used again
    // const newSession = new Session({
    //   sigDigest: "n/a",
    //   idvProvider: "n/a",
    //   status: sessionStatusEnum.REFUNDED,
    //   txHash,
    //   chainId,
    //   refundTxHash: txResponse.hash,
    // });
    // await newSession.save();

    // return res.status(200).json({
    //   message: `Successfully refunded user ${to} for transaction ${txHash} on chain ${chainId}.`,
    //   refundTxHash: txResponse.hash,
    // });
  } catch (err) {
    postEndpointLogger.error({ error: err, errMsg: (err as Error).message });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}
