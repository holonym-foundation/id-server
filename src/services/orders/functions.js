async function handleRefund(order) {
    // TODO: Implement refund logic
    // do we reuse the refund logic from the session creation?

    // get tx
    const tx = await getTransaction(order.chainId, order.txHash);

    // get tx status
    const txStatus = await getTransactionStatus(tx);
    
}

export { handleRefund };
