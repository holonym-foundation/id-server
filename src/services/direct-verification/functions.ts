import { ObjectId } from "mongodb";
import { DVCustomer, DVAPIKey, DVOrder, DVSession } from "../../init.js";
import { Request } from "express";
import { DirectVerification } from "../../types.js";
import {
  directVerificationSessionStatusEnum as dvStatuses
} from "../../constants/misc.js";

/**
 * Validate the API key, and lookup the customer document using the API key.
 */
export async function customerFromAPIKey(req: Request) {
  const customerApiKey = req.headers['x-customer-api-key']

  if (typeof customerApiKey != 'string') {
    throw new Error("Customer API key is required and must be a string")
  }

  let apiKeyOID = null;
  try {
    apiKeyOID = new ObjectId(customerApiKey);
  } catch (err) {
    throw new Error("Invalid customer API key. Invalid formatting")
  }

  const apiKeyDoc = await DVAPIKey.findOne({ _id: apiKeyOID })

  if (!apiKeyDoc) {
    throw new Error("Invalid customer API key. API key not found")
  }

  const customer = await DVCustomer.findOne({ _id: apiKeyDoc.customerId })

  if (!customer) {
    throw new Error("Unexpected: No customer associated with the provided API key")
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
    throw new Error("Insufficient credits: Customer has used their credits");
  }

  return true;
}