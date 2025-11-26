import AWS from 'aws-sdk'

// Validate required AWS credentials are present
if (!process.env.AWS_DYNAMODB_ACCESS_KEY_ID) {
  throw new Error(
    'AWS_DYNAMODB_ACCESS_KEY_ID environment variable is required for connecting to DynamoDB'
  )
}
if (!process.env.AWS_DYNAMODB_SECRET_ACCESS_KEY) {
  throw new Error(
    'AWS_DYNAMODB_SECRET_ACCESS_KEY environment variable is required for connecting to DynamoDB'
  )
}

// Configure AWS credentials from environment variables
AWS.config.update({
  region: 'us-east-2',
  credentials: {
    // accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    // secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    accessKeyId: process.env.AWS_DYNAMODB_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_DYNAMODB_SECRET_ACCESS_KEY
  }
})

export const ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' })

export interface PayPalOrder {
  id: string
  createdAt: string
}

export interface PhoneSessionPayPalData {
  orders: PayPalOrder[]
}

export interface PhoneSession {
  id: string
  sigDigest: string
  sessionStatus: string
  chainId?: string
  txHash?: string
  numAttempts: number
  refundTxHash?: string
  payPal?: string // JSON stringified PhoneSessionPayPalData
}

export interface NullifierAndCreds {
  issuanceNullifier: string
  phoneNumber: string
  createdAt: number // Unix timestamp
}

// Helper function to get a phone number from the db
const getNumberParams = (value: string) => ({
  TableName: 'phone-numbers',
  Key: { phoneNumber: { S: `${value}` } }
})

// Helper function to insert a phone number into the db
const putNumberParams = (value: string) => ({
  TableName: 'phone-numbers',
  Item: {
    phoneNumber: {
      S: `${value}`
    },
    insertedAt: {
      N: `${Date.now()}`
    }
  }
})

// Returns true if number exists, false otherwise
export const numberExists = (
  number: string,
  callback: (err: AWS.AWSError | null, data: boolean) => void
): void => {
  void ddb.getItem(getNumberParams(number), (err, data) =>
    callback(err, data && 'Item' in data ? true : false)
  )
}

// Adds number to the db
export const addNumber = (number: string): void => {
  void ddb.putItem(putNumberParams(number), (err) => {
    if (err) throw 'Error storing number'
  })
}

export const getNumber = (
  number: string,
  callback: (err: AWS.AWSError | null, data: AWS.DynamoDB.GetItemOutput) => void
): void => {
  void ddb.getItem(getNumberParams(number), (err, data) => callback(err, data))
}

export const deleteNumber = (
  number: string,
  callback: (
    err: AWS.AWSError | null,
    data: AWS.DynamoDB.DeleteItemOutput
  ) => void
): void => {
  void ddb.deleteItem(getNumberParams(number), (err, data) =>
    callback(err, data)
  )
}

/**
 * Common function to put a phone session - works for both live and sandbox
 * `status` is a reserved keyword in DynamoDB, so we name it `sessionStatus`.
 */
const putPhoneSessionCommon = (
  tableName: string,
  //   id: string | undefined,
  id: string,
  // sigDigest: string | undefined,
  sigDigest: string,
  // sessionStatus: string | undefined,
  sessionStatus: string,
  chainId: string | null,
  txHash: string | null,
  // numAttempts: number | undefined,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null
): Promise<AWS.DynamoDB.PutItemOutput> => {
  const params: AWS.DynamoDB.PutItemInput = {
    TableName: tableName,
    Item: {
      id: { S: `${id}` },
      sigDigest: { S: `${sigDigest}` },
      sessionStatus: { S: `${sessionStatus}` },
      ...(chainId ? { chainId: { N: `${chainId}` } } : {}),
      ...(txHash ? { txHash: { S: `${txHash}` } } : {}),
      numAttempts: { N: `${numAttempts}` },
      ...(refundTxHash ? { refundTxHash: { S: `${refundTxHash}` } } : {}),
      ...(payPal ? { payPal: { S: `${payPal}` } } : {})
    }
  }
  return ddb.putItem(params).promise()
}

/**
 * `status` is a reserved keyword in DynamoDB, so we name it `sessionStatus`.
 */
export const putPhoneSession = (
  id: string,
  sigDigest: string,
  sessionStatus: string,
  chainId: string | null,
  txHash: string | null,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null
): Promise<AWS.DynamoDB.PutItemOutput> => {
  return putPhoneSessionCommon(
    'phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal
  )
}

/**
 * Common function to update a phone session - works for both live and sandbox
 */
const updatePhoneSessionCommon = (
  tableName: string,
  id: string,
  sigDigest: string | null,
  sessionStatus: string | null,
  chainId: string | null,
  txHash: string | null,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null,
  failureReason: string | null
): Promise<AWS.DynamoDB.UpdateItemOutput> => {
  // console.log(
  //     'updating session. args:',
  //     [id, sigDigest, sessionStatus, chainId, txHash, numAttempts, refundTxHash, payPal]
  // )
  const expressions = [
    sigDigest ? 'sigDigest = :sigDigest' : '',
    sessionStatus ? 'sessionStatus = :sessionStatus' : '',
    chainId ? 'chainId = :chainId' : '',
    txHash ? 'txHash = :txHash' : '',
    numAttempts !== undefined && numAttempts !== null
      ? 'numAttempts = :numAttempts'
      : '',
    refundTxHash ? 'refundTxHash = :refundTxHash' : '',
    payPal ? 'payPal = :payPal' : '',
    failureReason ? 'failureReason = :failureReason' : ''
  ]
    .filter((x) => x !== '')
    .join(', ')
  const updateExpression = 'SET ' + expressions
  const expressionAttributeValues: AWS.DynamoDB.ExpressionAttributeValueMap = {
    ...(sigDigest ? { ':sigDigest': { S: sigDigest } } : {}),
    ...(sessionStatus ? { ':sessionStatus': { S: sessionStatus } } : {}),
    ...(chainId ? { ':chainId': { N: chainId } } : {}),
    ...(txHash ? { ':txHash': { S: txHash } } : {}),
    ...(numAttempts !== undefined && numAttempts !== null
      ? { ':numAttempts': { N: `${numAttempts}` } }
      : {}),
    ...(refundTxHash ? { ':refundTxHash': { S: refundTxHash } } : {}),
    ...(payPal ? { ':payPal': { S: payPal } } : {}),
    ...(failureReason ? { ':failureReason': { S: failureReason } } : {})
  }
  const params: AWS.DynamoDB.UpdateItemInput = {
    TableName: tableName,
    Key: { id: { S: `${id}` } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }
  // console.log('updatePhoneSession: update params:', JSON.stringify(params, null, 2))
  return ddb.updateItem(params).promise()
}

export const updatePhoneSession = (
  id: string,
  sigDigest: string | null,
  sessionStatus: string | null,
  chainId: string | null,
  txHash: string | null,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null,
  failureReason: string | null
): Promise<AWS.DynamoDB.UpdateItemOutput> => {
  return updatePhoneSessionCommon(
    'phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal,
    failureReason
  )
}

const getPhoneSessionByIdCommon = (
  tableName: string,
  id: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  const params: AWS.DynamoDB.GetItemInput = {
    TableName: tableName,
    Key: { id: { S: `${id}` } }
  }
  return ddb.getItem(params).promise()
}

export const getPhoneSessionById = (
  id: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  return getPhoneSessionByIdCommon('phone-sessions', id)
}

const getPhoneSessionsBySigDigestCommon = (
  tableName: string,
  sigDigest: string
): Promise<AWS.DynamoDB.QueryOutput> => {
  const params: AWS.DynamoDB.QueryInput = {
    TableName: tableName,
    IndexName: 'sigDigest-index',
    KeyConditionExpression: 'sigDigest = :sigDigest',
    ExpressionAttributeValues: {
      ':sigDigest': { S: `${sigDigest}` }
    }
  }
  return ddb.query(params).promise() as any
}

export const getPhoneSessionsBySigDigest = (
  sigDigest: string
): Promise<AWS.DynamoDB.QueryOutput> => {
  return getPhoneSessionsBySigDigestCommon('phone-sessions', sigDigest)
}

export const getPhoneSessionByTxHash = async (
  txHash: string
): Promise<AWS.DynamoDB.AttributeMap | undefined> => {
  const params: AWS.DynamoDB.QueryInput = {
    TableName: 'phone-sessions',
    IndexName: 'txHash-index',
    KeyConditionExpression: 'txHash = :txHash',
    ExpressionAttributeValues: {
      ':txHash': { S: `${txHash}` }
    }
  }
  // There should be, at most, one session with with a given txHash, hence
  // the .Items?.[0] below.
  const sessions = await ddb.query(params).promise()
  return sessions?.Items?.[0]
}

/**
 * Batch put vouchers into DynamoDB.
 */
export const batchPutVouchers = async (
  items: AWS.DynamoDB.WriteRequest[]
): Promise<void> => {
  const BATCH_SIZE = 25 // max limit of dynamodb
  const batches: AWS.DynamoDB.WriteRequest[][] = []

  // Split items into batches of 25
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE))
  }

  // Write each batch to DynamoDB
  for (const batch of batches) {
    const params: AWS.DynamoDB.BatchWriteItemInput = {
      RequestItems: {
        vouchers: batch
      }
    }
    await ddb.batchWriteItem(params).promise()
  }
}

export const updateVoucher = (
  id: string,
  isRedeemed: boolean | undefined,
  sessionId: string | undefined,
  txHash: string | null
): Promise<AWS.DynamoDB.UpdateItemOutput> => {
  const expressions = [
    isRedeemed !== undefined ? 'isRedeemed = :isRedeemed' : '',
    sessionId ? 'sessionId = :sessionId' : '',
    txHash ? 'txHash = :txHash' : ''
  ]
    .filter((x) => x !== '')
    .join(', ')
  const updateExpression = 'SET ' + expressions
  const expressionAttributeValues: AWS.DynamoDB.ExpressionAttributeValueMap = {
    ...(isRedeemed !== undefined
      ? { ':isRedeemed': { BOOL: isRedeemed } }
      : {}),
    ...(sessionId ? { ':sessionId': { S: sessionId } } : {}),
    ...(txHash ? { ':txHash': { S: txHash } } : {})
  }
  const params: AWS.DynamoDB.UpdateItemInput = {
    TableName: 'vouchers',
    Key: { id: { S: `${id}` } },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues
  }
  return ddb.updateItem(params).promise()
}

export const getVoucherById = (
  id: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  const params: AWS.DynamoDB.GetItemInput = {
    TableName: 'vouchers',
    Key: { id: { S: `${id}` } }
  }
  return ddb.getItem(params).promise()
}

export const getVoucherByTxHash = async (
  txHash: string
): Promise<AWS.DynamoDB.AttributeMap | undefined> => {
  const params: AWS.DynamoDB.QueryInput = {
    TableName: 'vouchers',
    IndexName: 'txHash-index',
    KeyConditionExpression: 'txHash = :txHash',
    ExpressionAttributeValues: {
      ':txHash': { S: `${txHash}` }
    }
  }
  const vouchers = await ddb.query(params).promise()
  console.log('sessions tx hash', vouchers)
  return vouchers?.Items?.[0]
}

const putNullifierAndCredsCommon = (
  tableName: string,
  issuanceNullifier: string,
  phoneNumber: string
): Promise<AWS.DynamoDB.PutItemOutput> => {
  const params: AWS.DynamoDB.PutItemInput = {
    TableName: tableName,
    Item: {
      issuanceNullifier: { S: `${issuanceNullifier}` },
      phoneNumber: { S: `${phoneNumber}` },
      createdAt: { N: `${Date.now().toString()}` }
    }
  }
  return ddb.putItem(params).promise()
}

export const putNullifierAndCreds = (
  issuanceNullifier: string,
  phoneNumber: string
): Promise<AWS.DynamoDB.PutItemOutput> => {
  return putNullifierAndCredsCommon(
    'phone-nullifier-and-creds',
    issuanceNullifier,
    phoneNumber
  )
}

const getNullifierAndCredsByNullifierCommon = (
  tableName: string,
  issuanceNullifier: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  const params: AWS.DynamoDB.GetItemInput = {
    TableName: tableName,
    Key: { issuanceNullifier: { S: `${issuanceNullifier}` } }
  }
  return ddb.getItem(params).promise()
}

export const getNullifierAndCredsByNullifier = (
  issuanceNullifier: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  return getNullifierAndCredsByNullifierCommon(
    'phone-nullifier-and-creds',
    issuanceNullifier
  )
}

// ========== SANDBOX FUNCTIONS ==========
// These are thin wrappers around the common functions

/**
 * Sandbox version of putPhoneSession - uses sandbox-phone-sessions table
 */
export const putSandboxPhoneSession = (
  id: string,
  sigDigest: string,
  sessionStatus: string,
  chainId: string | null,
  txHash: string | null,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null
): Promise<AWS.DynamoDB.PutItemOutput> => {
  return putPhoneSessionCommon(
    'sandbox-phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal
  )
}

/**
 * Sandbox version of updatePhoneSession - uses sandbox-phone-sessions table
 */
export const updateSandboxPhoneSession = (
  id: string,
  sigDigest: string | null,
  sessionStatus: string | null,
  chainId: string | null,
  txHash: string | null,
  numAttempts: number | null,
  refundTxHash: string | null,
  payPal: string | null,
  failureReason: string | null
): Promise<AWS.DynamoDB.UpdateItemOutput> => {
  return updatePhoneSessionCommon(
    'sandbox-phone-sessions',
    id,
    sigDigest,
    sessionStatus,
    chainId,
    txHash,
    numAttempts,
    refundTxHash,
    payPal,
    failureReason
  )
}

export const getSandboxPhoneSessionById = (
  id: string
): Promise<AWS.DynamoDB.GetItemOutput> => {
  return getPhoneSessionByIdCommon('sandbox-phone-sessions', id)
}

export const getSandboxPhoneSessionsBySigDigest = (
  sigDigest: string
): Promise<AWS.DynamoDB.QueryOutput> => {
  return getPhoneSessionsBySigDigestCommon('sandbox-phone-sessions', sigDigest)
}

// const putSandboxNullifierAndCreds = (issuanceNullifier, phoneNumber) => {
//   return putNullifierAndCredsCommon('sandbox-nullifier-and-creds', issuanceNullifier, phoneNumber)
// }

// const getSandboxNullifierAndCredsByNullifier = (issuanceNullifier) => {
//   return getNullifierAndCredsByNullifierCommon('sandbox-nullifier-and-creds', issuanceNullifier)
// }

// Usage:
// addNumber('+1234567890')
// numberExists('+1234567890', (x)=>console.log('this should now be true', x))
