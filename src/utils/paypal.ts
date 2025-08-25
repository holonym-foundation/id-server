import axios from "axios";
import { HydratedDocument } from "mongoose";
import { ISession } from "../types.js";
import { payPalApiUrlBase, sessionStatusEnum } from "../constants/misc.js";

// ------------------- Simple API calls -------------------

async function getAccessToken() {
  const url = `${payPalApiUrlBase}/v1/oauth2/token`;
  const data = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const config = {
    auth: {
      username: process.env.PAYPAL_CLIENT_ID,
      password: process.env.PAYPAL_SECRET,
    },
  };
  // ignoring "Property 'post' does not exist on type 'typeof import()'"
  // @ts-ignore
  const response = await axios.post(url, data, config);
  return response?.data?.access_token;
}

async function getOrder(id: string, accessToken: string) {
  const url = `${payPalApiUrlBase}/v2/checkout/orders/${id}`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  // ignoring "Property 'get' does not exist on type 'typeof import()'"
  // @ts-ignore
  const resp = await axios.get(url, config);
  return resp.data;
}

async function getRefundDetails(id: string, accessToken: string) {
  const url = `${payPalApiUrlBase}/v2/payments/refunds/${id}`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  // ignoring "Property 'get' does not exist on type 'typeof import()'"
  // @ts-ignore
  const resp = await axios.get(url, config);
  return resp.data;
}

async function capturePayPalOrder(orderId: string) {
  const accessToken = await getAccessToken();

  const url = `${payPalApiUrlBase}/v2/checkout/orders/${orderId}/capture`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  // ignoring "Property 'post' does not exist on type 'typeof import()'"
  // @ts-ignore
  const resp = await axios.post(url, {}, config);

  return resp.data;
}

// ------------------- END Simple API calls -------------------

/**
 * @param session - Either a regular KYC session or an AML checks session. This
 * function accesses .payPal?.orders on the session object, and, if the refund is 
 * successful, it sets the session status to REFUNDED.
 */
async function refundMintFeePayPal(session: HydratedDocument<ISession>) {
  const accessToken = await getAccessToken();

  const orders = session.payPal?.orders ?? [];

  if (orders.length === 0) {
    return {
      status: 404,
      data: {
        error: "No PayPal orders found for session",
      },
    };
  }

  let successfulOrder;
  for (const { id: orderId } of orders) {
    const order = await getOrder(orderId as string, accessToken);
    if (order.status === "COMPLETED") {
      successfulOrder = order;
      break;
    }
  }

  if (!successfulOrder) {
    return {
      status: 404,
      data: {
        error: "No successful PayPal orders found for session",
      },
    };
  }

  // Get the first successful payment capture
  let capture;
  for (const pu of successfulOrder.purchase_units) {
    for (const payment of pu.payments.captures) {
      if (payment.status === "COMPLETED") {
        capture = payment;
        break;
      }
    }
  }

  if (!capture) {
    return {
      status: 404,
      data: {
        error: "No successful PayPal payment captures found for session",
      },
    };
  }

  const paymentId = capture.id;

  // PayPal returns a 403 when trying to get refund details. Not sure if this
  // is because no refund exists had been performed yet or because of some other.
  // issue I tried creating new credentials and using the sandbox API but still
  // got a 403.
  // const refundDetails = await getPayPalRefundDetails(paymentId, accessToken);

  // if (refundDetails.status === "COMPLETED") {
  //   return {
  //     status: 400,
  //     data: {
  //       error: "Payment has already been refunded",
  //     },
  //   };
  // }

  const url = `${payPalApiUrlBase}/v2/payments/captures/${paymentId}/refund`;
  const config = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  };
  const data = {
    amount: {
      value: "7.53",
      currency_code: "USD",
    },
    // invoice_id: "INVOICE-123",
    note_to_payer: "Failed verification",
  };
  // ignoring "Property 'post' does not exist on type 'typeof import()'"
  // @ts-ignore
  const resp = await axios.post(url, data, config);

  if (resp.data?.status !== "COMPLETED") {
    return {
      status: 500,
      data: {
        error: "Error refunding payment",
      },
    };
  }

  session.status = sessionStatusEnum.REFUNDED;
  await session.save();

  return {
    status: 200,
    data: {},
  };
}

export {
  getAccessToken,
  getOrder,
  getRefundDetails,
  capturePayPalOrder,
  refundMintFeePayPal,
};
