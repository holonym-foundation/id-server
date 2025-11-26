import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Mock } from 'bun:test'

// Create mock functions for DynamoDB methods
const mockGetItem = mock()
const mockPutItem = mock()
const mockDeleteItem = mock()
const mockUpdateItem = mock()
const mockQuery = mock()
const mockBatchWriteItem = mock()

// Import the module first
import {
  numberExists,
  addNumber,
  getNumber,
  deleteNumber,
  putPhoneSession,
  updatePhoneSession,
  getPhoneSessionById,
  getPhoneSessionsBySigDigest,
  getPhoneSessionByTxHash,
  batchPutVouchers,
  updateVoucher,
  getVoucherById,
  getVoucherByTxHash,
  putNullifierAndCreds,
  getNullifierAndCredsByNullifier,
  putSandboxPhoneSession,
  updateSandboxPhoneSession,
  getSandboxPhoneSessionById,
  getSandboxPhoneSessionsBySigDigest,
  ddb
} from './dynamodb.js'

describe('dynamodb', () => {
  beforeEach(() => {
    // Replace the ddb methods with our mocks before each test
    ddb.getItem = mockGetItem as any
    ddb.putItem = mockPutItem as any
    ddb.deleteItem = mockDeleteItem as any
    ddb.updateItem = mockUpdateItem as any
    ddb.query = mockQuery as any
    ddb.batchWriteItem = mockBatchWriteItem as any

    // Clear mock call history
    mockGetItem.mockClear()
    mockPutItem.mockClear()
    mockDeleteItem.mockClear()
    mockUpdateItem.mockClear()
    mockQuery.mockClear()
    mockBatchWriteItem.mockClear()
  })

  describe('numberExists', () => {
    it('should return true when number exists', (done?: () => void) => {
      mockGetItem.mockImplementation((params: any, callback: any) => {
        callback(null, { Item: { phoneNumber: { S: '+1234567890' } } })
      })

      numberExists('+1234567890', (err, exists) => {
        expect(err).toBeNull()
        expect(exists).toBe(true)
        expect(mockGetItem).toHaveBeenCalledWith(
          {
            TableName: 'phone-numbers',
            Key: { phoneNumber: { S: '+1234567890' } }
          },
          expect.any(Function)
        )
        done?.()
      })
    })

    it('should return false when number does not exist', (done?: () => void) => {
      mockGetItem.mockImplementation((params: any, callback: any) => {
        callback(null, {})
      })

      numberExists('+1234567890', (err, exists) => {
        expect(err).toBeNull()
        expect(exists).toBe(false)
        done?.()
      })
    })

    it('should handle errors', (done?: () => void) => {
      const error = new Error('DynamoDB error') as AWS.AWSError
      mockGetItem.mockImplementation((params: any, callback: any) => {
        callback(error, null)
      })

      numberExists('+1234567890', (err, exists) => {
        expect(err).toBe(error)
        expect(exists).toBe(false)
        done?.()
      })
    })
  })

  describe('addNumber', () => {
    it('should add a number successfully', () => {
      mockPutItem.mockImplementation((params: any, callback: any) => {
        callback(null, {})
      })

      expect(() => addNumber('+1234567890')).not.toThrow()
      expect(mockPutItem).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'phone-numbers',
          Item: expect.objectContaining({
            phoneNumber: { S: '+1234567890' },
            insertedAt: expect.objectContaining({ N: expect.any(String) })
          })
        }),
        expect.any(Function)
      )
    })

    it('should throw error when putItem fails', () => {
      mockPutItem.mockImplementation((params: any, callback: any) => {
        callback(new Error('DynamoDB error'), null)
      })

      expect(() => addNumber('+1234567890')).toThrow('Error storing number')
    })
  })

  describe('getNumber', () => {
    it('should get a number successfully', (done?: () => void) => {
      const mockData = { Item: { phoneNumber: { S: '+1234567890' } } }
      mockGetItem.mockImplementation((params: any, callback: any) => {
        callback(null, mockData)
      })

      getNumber('+1234567890', (err, data) => {
        expect(err).toBeNull()
        expect(data).toEqual(mockData)
        expect(mockGetItem).toHaveBeenCalledWith(
          {
            TableName: 'phone-numbers',
            Key: { phoneNumber: { S: '+1234567890' } }
          },
          expect.any(Function)
        )
        done?.()
      })
    })

    it('should handle errors', (done?: () => void) => {
      const error = new Error('DynamoDB error') as AWS.AWSError
      mockGetItem.mockImplementation((params: any, callback: any) => {
        callback(error, null)
      })

      getNumber('+1234567890', (err, data) => {
        expect(err).toBe(error)
        done?.()
      })
    })
  })

  describe('deleteNumber', () => {
    it('should delete a number successfully', (done?: () => void) => {
      const mockData = {}
      mockDeleteItem.mockImplementation((params: any, callback: any) => {
        callback(null, mockData)
      })

      deleteNumber('+1234567890', (err, data) => {
        expect(err).toBeNull()
        expect(data).toEqual(mockData)
        expect(mockDeleteItem).toHaveBeenCalledWith(
          {
            TableName: 'phone-numbers',
            Key: { phoneNumber: { S: '+1234567890' } }
          },
          expect.any(Function)
        )
        done?.()
      })
    })

    it('should handle errors', (done?: () => void) => {
      const error = new Error('DynamoDB error') as AWS.AWSError
      mockDeleteItem.mockImplementation((params: any, callback: any) => {
        callback(error, null)
      })

      deleteNumber('+1234567890', (err, data) => {
        expect(err).toBe(error)
        done?.()
      })
    })
  })

  describe('putPhoneSession', () => {
    it('should put a phone session with all fields', async () => {
      const mockResponse = {}
      mockPutItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await putPhoneSession(
        'session-id',
        'sig-digest',
        'pending',
        '1',
        'tx-hash',
        3,
        'refund-tx-hash',
        '{"orders":[]}'
      )

      expect(result).toEqual(mockResponse)
      expect(mockPutItem).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        Item: {
          id: { S: 'session-id' },
          sigDigest: { S: 'sig-digest' },
          sessionStatus: { S: 'pending' },
          chainId: { N: '1' },
          txHash: { S: 'tx-hash' },
          numAttempts: { N: '3' },
          refundTxHash: { S: 'refund-tx-hash' },
          payPal: { S: '{"orders":[]}' }
        }
      })
    })

    it('should put a phone session with null optional fields', async () => {
      const mockResponse = {}
      mockPutItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      await putPhoneSession(
        'session-id',
        'sig-digest',
        'pending',
        null,
        null,
        null,
        null,
        null
      )

      expect(mockPutItem).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        Item: {
          id: { S: 'session-id' },
          sigDigest: { S: 'sig-digest' },
          sessionStatus: { S: 'pending' },
          numAttempts: { N: 'null' }
        }
      })
    })
  })

  describe('updatePhoneSession', () => {
    it('should update a phone session with all fields', async () => {
      const mockResponse = {}
      mockUpdateItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await updatePhoneSession(
        'session-id',
        'sig-digest',
        'completed',
        '1',
        'tx-hash',
        5,
        'refund-tx-hash',
        '{"orders":[]}',
        'failure-reason'
      )

      expect(result).toEqual(mockResponse)
      expect(mockUpdateItem).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        Key: { id: { S: 'session-id' } },
        UpdateExpression: expect.stringContaining('SET'),
        ExpressionAttributeValues: expect.objectContaining({
          ':sigDigest': { S: 'sig-digest' },
          ':sessionStatus': { S: 'completed' },
          ':chainId': { N: '1' },
          ':txHash': { S: 'tx-hash' },
          ':numAttempts': { N: '5' },
          ':refundTxHash': { S: 'refund-tx-hash' },
          ':payPal': { S: '{"orders":[]}' },
          ':failureReason': { S: 'failure-reason' }
        })
      })
    })

    it('should update a phone session with only some fields', async () => {
      const mockResponse = {}
      mockUpdateItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      await updatePhoneSession(
        'session-id',
        null,
        'completed',
        null,
        null,
        3,
        null,
        null,
        null
      )

      const callArgs = mockUpdateItem.mock
        .calls[0][0] as AWS.DynamoDB.UpdateItemInput
      expect(callArgs.UpdateExpression).toContain('sessionStatus')
      expect(callArgs.UpdateExpression).toContain('numAttempts')
      expect(callArgs.ExpressionAttributeValues).not.toHaveProperty(
        ':sigDigest'
      )
      expect(callArgs.ExpressionAttributeValues).toHaveProperty(
        ':sessionStatus'
      )
      expect(callArgs.ExpressionAttributeValues).toHaveProperty(':numAttempts')
    })

    it('should handle null numAttempts', async () => {
      const mockResponse = {}
      mockUpdateItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      await updatePhoneSession(
        'session-id',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
      )

      const callArgs = mockUpdateItem.mock
        .calls[0][0] as AWS.DynamoDB.UpdateItemInput
      expect(callArgs.UpdateExpression).not.toContain('numAttempts')
      expect(callArgs.ExpressionAttributeValues).not.toHaveProperty(
        ':numAttempts'
      )
    })
  })

  describe('getPhoneSessionById', () => {
    it('should get a phone session by id', async () => {
      const mockResponse = { Item: { id: { S: 'session-id' } } }
      mockGetItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getPhoneSessionById('session-id')

      expect(result).toEqual(mockResponse)
      expect(mockGetItem).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        Key: { id: { S: 'session-id' } }
      })
    })
  })

  describe('getPhoneSessionsBySigDigest', () => {
    it('should query phone sessions by sigDigest', async () => {
      const mockResponse = {
        Items: [{ id: { S: 'session-id' }, sigDigest: { S: 'sig-digest' } }]
      }
      mockQuery.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getPhoneSessionsBySigDigest('sig-digest')

      expect(result).toEqual(mockResponse)
      expect(mockQuery).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        IndexName: 'sigDigest-index',
        KeyConditionExpression: 'sigDigest = :sigDigest',
        ExpressionAttributeValues: {
          ':sigDigest': { S: 'sig-digest' }
        }
      })
    })
  })

  describe('getPhoneSessionByTxHash', () => {
    it('should get a phone session by txHash', async () => {
      const mockItem = { id: { S: 'session-id' }, txHash: { S: 'tx-hash' } }
      const mockResponse = { Items: [mockItem] }
      mockQuery.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getPhoneSessionByTxHash('tx-hash')

      expect(result).toEqual(mockItem)
      expect(mockQuery).toHaveBeenCalledWith({
        TableName: 'phone-sessions',
        IndexName: 'txHash-index',
        KeyConditionExpression: 'txHash = :txHash',
        ExpressionAttributeValues: {
          ':txHash': { S: 'tx-hash' }
        }
      })
    })

    it('should return undefined when no session found', async () => {
      const mockResponse = { Items: [] }
      mockQuery.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getPhoneSessionByTxHash('tx-hash')

      expect(result).toBeUndefined()
    })
  })

  describe('batchPutVouchers', () => {
    it('should batch put vouchers in chunks of 25', async () => {
      const items: AWS.DynamoDB.WriteRequest[] = Array.from(
        { length: 50 },
        (_, i) => ({
          PutRequest: {
            Item: {
              id: { S: `voucher-${i}` }
            }
          }
        })
      )

      mockBatchWriteItem.mockReturnValue({
        promise: () => Promise.resolve({})
      })

      await batchPutVouchers(items)

      expect(mockBatchWriteItem).toHaveBeenCalledTimes(2)
      expect(mockBatchWriteItem).toHaveBeenNthCalledWith(1, {
        RequestItems: {
          vouchers: items.slice(0, 25)
        }
      })
      expect(mockBatchWriteItem).toHaveBeenNthCalledWith(2, {
        RequestItems: {
          vouchers: items.slice(25, 50)
        }
      })
    })

    it('should handle empty items array', async () => {
      mockBatchWriteItem.mockReturnValue({
        promise: () => Promise.resolve({})
      })

      await batchPutVouchers([])

      expect(mockBatchWriteItem).not.toHaveBeenCalled()
    })

    it('should handle exactly 25 items', async () => {
      const items: AWS.DynamoDB.WriteRequest[] = Array.from(
        { length: 25 },
        (_, i) => ({
          PutRequest: {
            Item: {
              id: { S: `voucher-${i}` }
            }
          }
        })
      )

      mockBatchWriteItem.mockReturnValue({
        promise: () => Promise.resolve({})
      })

      await batchPutVouchers(items)

      expect(mockBatchWriteItem).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateVoucher', () => {
    it('should update a voucher with all fields', async () => {
      const mockResponse = {}
      mockUpdateItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await updateVoucher(
        'voucher-id',
        true,
        'session-id',
        'tx-hash'
      )

      expect(result).toEqual(mockResponse)
      expect(mockUpdateItem).toHaveBeenCalledWith({
        TableName: 'vouchers',
        Key: { id: { S: 'voucher-id' } },
        UpdateExpression: expect.stringContaining('SET'),
        ExpressionAttributeValues: expect.objectContaining({
          ':isRedeemed': { BOOL: true },
          ':sessionId': { S: 'session-id' },
          ':txHash': { S: 'tx-hash' }
        })
      })
    })

    it('should update a voucher with only some fields', async () => {
      const mockResponse = {}
      mockUpdateItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      await updateVoucher('voucher-id', false, undefined, null)

      const callArgs = mockUpdateItem.mock
        .calls[0][0] as AWS.DynamoDB.UpdateItemInput
      expect(callArgs.ExpressionAttributeValues).toHaveProperty(':isRedeemed')
      expect(callArgs.ExpressionAttributeValues).not.toHaveProperty(
        ':sessionId'
      )
      expect(callArgs.ExpressionAttributeValues).not.toHaveProperty(':txHash')
    })
  })

  describe('getVoucherById', () => {
    it('should get a voucher by id', async () => {
      const mockResponse = { Item: { id: { S: 'voucher-id' } } }
      mockGetItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getVoucherById('voucher-id')

      expect(result).toEqual(mockResponse)
      expect(mockGetItem).toHaveBeenCalledWith({
        TableName: 'vouchers',
        Key: { id: { S: 'voucher-id' } }
      })
    })
  })

  describe('getVoucherByTxHash', () => {
    it('should get a voucher by txHash', async () => {
      const mockItem = { id: { S: 'voucher-id' }, txHash: { S: 'tx-hash' } }
      const mockResponse = { Items: [mockItem] }
      mockQuery.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getVoucherByTxHash('tx-hash')

      expect(result).toEqual(mockItem)
      expect(mockQuery).toHaveBeenCalledWith({
        TableName: 'vouchers',
        IndexName: 'txHash-index',
        KeyConditionExpression: 'txHash = :txHash',
        ExpressionAttributeValues: {
          ':txHash': { S: 'tx-hash' }
        }
      })
    })

    it('should return undefined when no voucher found', async () => {
      const mockResponse = { Items: [] }
      mockQuery.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getVoucherByTxHash('tx-hash')

      expect(result).toBeUndefined()
    })
  })

  describe('putNullifierAndCreds', () => {
    it('should put nullifier and creds', async () => {
      const mockResponse = {}
      mockPutItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await putNullifierAndCreds('nullifier-123', '+1234567890')

      expect(result).toEqual(mockResponse)
      expect(mockPutItem).toHaveBeenCalledWith({
        TableName: 'phone-nullifier-and-creds',
        Item: {
          issuanceNullifier: { S: 'nullifier-123' },
          phoneNumber: { S: '+1234567890' },
          createdAt: expect.objectContaining({ N: expect.any(String) })
        }
      })
    })
  })

  describe('getNullifierAndCredsByNullifier', () => {
    it('should get nullifier and creds by nullifier', async () => {
      const mockResponse = {
        Item: {
          issuanceNullifier: { S: 'nullifier-123' },
          phoneNumber: { S: '+1234567890' }
        }
      }
      mockGetItem.mockReturnValue({
        promise: () => Promise.resolve(mockResponse)
      })

      const result = await getNullifierAndCredsByNullifier('nullifier-123')

      expect(result).toEqual(mockResponse)
      expect(mockGetItem).toHaveBeenCalledWith({
        TableName: 'phone-nullifier-and-creds',
        Key: { issuanceNullifier: { S: 'nullifier-123' } }
      })
    })
  })

  describe('Sandbox functions', () => {
    describe('putSandboxPhoneSession', () => {
      it('should put a sandbox phone session', async () => {
        const mockResponse = {}
        mockPutItem.mockReturnValue({
          promise: () => Promise.resolve(mockResponse)
        })

        await putSandboxPhoneSession(
          'session-id',
          'sig-digest',
          'pending',
          null,
          null,
          null,
          null,
          null
        )

        expect(mockPutItem).toHaveBeenCalledWith(
          expect.objectContaining({
            TableName: 'sandbox-phone-sessions'
          })
        )
      })
    })

    describe('updateSandboxPhoneSession', () => {
      it('should update a sandbox phone session', async () => {
        const mockResponse = {}
        mockUpdateItem.mockReturnValue({
          promise: () => Promise.resolve(mockResponse)
        })

        await updateSandboxPhoneSession(
          'session-id',
          null,
          'completed',
          null,
          null,
          1,
          null,
          null,
          null
        )

        expect(mockUpdateItem).toHaveBeenCalledWith(
          expect.objectContaining({
            TableName: 'sandbox-phone-sessions'
          })
        )
      })
    })

    describe('getSandboxPhoneSessionById', () => {
      it('should get a sandbox phone session by id', async () => {
        const mockResponse = { Item: { id: { S: 'session-id' } } }
        mockGetItem.mockReturnValue({
          promise: () => Promise.resolve(mockResponse)
        })

        await getSandboxPhoneSessionById('session-id')

        expect(mockGetItem).toHaveBeenCalledWith({
          TableName: 'sandbox-phone-sessions',
          Key: { id: { S: 'session-id' } }
        })
      })
    })

    describe('getSandboxPhoneSessionsBySigDigest', () => {
      it('should query sandbox phone sessions by sigDigest', async () => {
        const mockResponse = { Items: [] }
        mockQuery.mockReturnValue({
          promise: () => Promise.resolve(mockResponse)
        })

        await getSandboxPhoneSessionsBySigDigest('sig-digest')

        expect(mockQuery).toHaveBeenCalledWith({
          TableName: 'sandbox-phone-sessions',
          IndexName: 'sigDigest-index',
          KeyConditionExpression: 'sigDigest = :sigDigest',
          ExpressionAttributeValues: {
            ':sigDigest': { S: 'sig-digest' }
          }
        })
      })
    })
  })
})
