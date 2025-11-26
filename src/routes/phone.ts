import express from "express";
import {
  userSessions as adminUserSessions,
  failSession as adminFailSession,
  deletePhoneNumber as adminDeletePhoneNumber
} from "../services/phone/admin/endpoints.js";
import {
  postSession,
  postSessionV2,
  createPayPalOrder,
  payment,
  paymentV2,
  paymentV3,
  redeemVoucher,
  refund,
  refundV2,
  isVoucherRedeemed,
  getSessionsSandbox,
  postSessionV2Sandbox,
  getSessions,
  generateVoucher,
} from "../services/phone/sessions/endpoints.js";
import {
  sendCode,
  sendCodeSandbox,
  getCredentials,
  getCredentialsSandbox,
} from "../services/phone/check-number.js";

const phoneRouter = express.Router()

phoneRouter.post('/admin/user-sessions', adminUserSessions)
phoneRouter.post('/admin/fail-session', adminFailSession)
phoneRouter.post('/admin/delete-phone-number', adminDeletePhoneNumber)

phoneRouter.post('/sessions/', postSession)
phoneRouter.post('/sessions/v2', postSessionV2)
phoneRouter.post('/sessions/:id/paypal-order', createPayPalOrder)
phoneRouter.post('/sessions/:id/payment', payment)
phoneRouter.post('/sessions/:id/payment/v2', paymentV2)
phoneRouter.post('/sessions/:id/payment/v3', paymentV3)
phoneRouter.post('/sessions/:id/redeem-voucher', redeemVoucher)
phoneRouter.post('/sessions/:id/refund', refund)
phoneRouter.post('/sessions/:id/refund/v2', refundV2)
phoneRouter.post('/sessions/is-voucher-redeemed', isVoucherRedeemed)
phoneRouter.get('/sessions', getSessions)
phoneRouter.get('/sessions/generate-voucher', generateVoucher)


phoneRouter.post('/send/v4', sendCode)
phoneRouter.get('/getCredentials/v6/:number/:code/:country/:sessionId/:nullifier', getCredentials)

const phoneRouterSandbox = express.Router()
phoneRouterSandbox.get('/sessions', getSessionsSandbox)
phoneRouterSandbox.post('/sessions/v2', postSessionV2Sandbox)
phoneRouterSandbox.post('/send/v4', sendCodeSandbox)
phoneRouterSandbox.get('/getCredentials/v6/:number/:code/:country/:sessionId/:nullifier', getCredentialsSandbox)

export default phoneRouter;
export { phoneRouterSandbox };
