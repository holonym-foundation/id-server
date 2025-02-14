/**
 * For API calls to admin endpoints in zeronym servers
 */
import axios from 'axios'

// -------------------- For id-server admin endpoints --------------------

function createIDVSession(sid: string, txHash: string, chainId: number) {
  // curl -X POST -d '{"chainId": "1", "txHash": "0x1234"}' https://id-server.holonym.io/sessions/<sid>/idv-session/v3
  return axios.post(
    `https://id-server.holonym.io/sessions/${sid}/idv-session/v3`,
    {
      txHash,
      chainId,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ADMIN_API_KEY_LOW_PRIVILEGE,
      }
    }
  )
}

function refundUnusedTransactionIdServer(txHash: string, chainId: number, to: string) {
  return axios.post(
    'https://id-server.holonym.io/admin/refund-unused-transaction',
    {
      txHash,
      chainId,
      to,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ADMIN_API_KEY_LOW_PRIVILEGE,
      }
    }
  )
}

export const idServerAdmin = {
  createIDVSession,
  refundUnusedTransaction: refundUnusedTransactionIdServer,
}

// -------------------- For phone-number-server admin endpoints --------------------

