import { DVCustomer, DVAPIKey, DVOrder, DVSession } from "../../init.js";
import { Request } from "express";
import { DirectVerification } from "../../types.js";
import { CustomError } from "../../utils/errors.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../../constants/misc.js";

/**
 * Validate the API key, and lookup the customer document using the API key.
 */
export async function customerFromAPIKey(req: Request) {
  const customerApiKey = req.headers['x-customer-api-key']

  if (typeof customerApiKey != 'string') {
    throw new CustomError({
      userFacingMessage: "Customer API key is required and must be a string",
      logMessage: "Customer API key is required and must be a string",
      httpStatusCode: 400
    })
  }

  // Validate hex string format
  if (!/^[0-9a-fA-F]+$/.test(customerApiKey)) {
    throw new CustomError({
      userFacingMessage: "Invalid customer API key format. Must be a hex string",
      logMessage: "Invalid customer API key format. Must be a hex string",
      httpStatusCode: 400
    })
  }

  const apiKeyDoc = await DVAPIKey.findOne({ key: customerApiKey })

  if (!apiKeyDoc) {
    throw new CustomError({
      userFacingMessage: "Invalid customer API key",
      logMessage: "Invalid customer API key. API key not found",
      httpStatusCode: 401
    })
  }

  const customer = await DVCustomer.findOne({ _id: apiKeyDoc.customerId })

  if (!customer) {
    throw new CustomError({
      userFacingMessage: "Invalid customer API key",
      logMessage: "Invalid customer API key. No customer associated with the provided API key",
      httpStatusCode: 401
    })
  }

  return customer
}

export async function validateCustomerCreditUsage(customer: DirectVerification.ICustomer) {
  const totalCreditsResult = await DVOrder.aggregate([
    { $match: { customerId: customer._id } },
    { $group: { _id: null, totalCredits: { $sum: "$credits" } } }
  ]);

  const totalCredits = totalCreditsResult[0]?.totalCredits || 0;

  const sessionStatusesToCount = [
    dvStatuses.ENROLLED,
    dvStatuses.PASSED_AGE_VERIFICATION,
    dvStatuses.VERIFICATION_FAILED
  ]

  const sessionsCount = await DVSession.countDocuments({
    customerId: customer._id,
    status: { $in: sessionStatusesToCount }
  });

  if (totalCredits <= sessionsCount) {
    throw new CustomError({
      userFacingMessage: "Insufficient credits: Customer has used their credits",
      logMessage: `Insufficient credits: Customer ${customer._id} has used their credits`,
      httpStatusCode: 402
    })
  }

  return true;
}