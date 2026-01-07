# Human ID Credits Admin API

This document describes the admin endpoints for managing Human ID Credits price overrides. These endpoints allow administrators to create, read, update, and delete custom pricing rules for specific users.

## Authentication

All admin endpoints require authentication via the `x-api-key` header. The API key must match the value set in the `HUMAN_ID_CREDITS_ADMIN_API_KEY` environment variable.

## Base URL

All endpoints are prefixed with `/admin/payments/human-id-credits/price-overrides`

## Price Override Model

See the [price override schema in `schemas.ts`](../src/schemas.ts) for the complete definition of the price override object returned by these endpoints.

## Endpoints

### Create Price Override

Create a new price override for a user.

**Endpoint:** `POST /admin/payments/human-id-credits/price-overrides`

**Request Body:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "priceUSD": 0.50,
  "maxCredits": 1000,
  "services": ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
  "expiresAt": "2024-12-31T23:59:59.000Z",
  "description": "Partner pricing for Q4 2024"
}
```

**Request Fields:**
- `userId` (string, required): Valid MongoDB ObjectId of the user
- `priceUSD` (number, required): Must be a positive number
- `maxCredits` (number, required): Must be a positive integer
- `services` (string[], required): Non-empty array of valid bytes32 service identifiers (0x followed by 64 hex characters)
- `expiresAt` (string, optional): ISO 8601 date string, must be in the future
- `description` (string, optional): Internal note

**Response:** `201 Created`
```json
{
  "id": "507f1f77bcf86cd799439012",
  "userId": "507f1f77bcf86cd799439011",
  "priceUSD": 0.50,
  "maxCredits": 1000,
  "usedCredits": 0,
  "services": ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
  "isActive": true,
  "expiresAt": "2024-12-31T23:59:59.000Z",
  "description": "Partner pricing for Q4 2024",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### List Price Overrides

List price overrides with optional filtering and pagination.

**Endpoint:** `GET /admin/payments/human-id-credits/price-overrides`

**Query Parameters:**
- `userId` (string, optional): Filter by user ID (MongoDB ObjectId)
- `isActive` (boolean, optional): Filter by active status (`true` or `false`)
- `limit` (number, optional): Number of results per page (1-1000, default: 100)
- `cursor` (string, optional): Pagination cursor (ObjectId from previous page)

**Example Request:**
```
GET /admin/payments/human-id-credits/price-overrides?userId=507f1f77bcf86cd799439011&isActive=true&limit=50
```

**Response:** `200 OK`
```json
{
  "overrides": [
    {
      "id": "507f1f77bcf86cd799439012",
      "userId": "507f1f77bcf86cd799439011",
      "priceUSD": 0.50,
      "maxCredits": 1000,
      "usedCredits": 250,
      "remainingCredits": 750,
      "services": ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
      "isActive": true,
      "expiresAt": "2024-12-31T23:59:59.000Z",
      "description": "Partner pricing for Q4 2024",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "limit": 50,
  "nextCursor": "507f1f77bcf86cd799439013",
  "hasNextPage": true
}
```

**Response Fields:**
- `overrides` (array): Array of price override objects
- `limit` (number): Number of results requested
- `nextCursor` (string|null): Cursor for the next page (null if no more pages)
- `hasNextPage` (boolean): Whether there are more results

**Pagination:**
- Use `cursor` from the response to fetch the next page
- Results are sorted by `createdAt` descending, then `_id` descending
- To get the next page, include the `cursor` query parameter with the `nextCursor` value from the previous response

---

### Get Price Override

Get a single price override by ID.

**Endpoint:** `GET /admin/payments/human-id-credits/price-overrides/:id`

**Path Parameters:**
- `id` (string, required): Price override ID (MongoDB ObjectId)

**Example Request:**
```
GET /admin/payments/human-id-credits/price-overrides/507f1f77bcf86cd799439012
```

**Response:** `200 OK`
```json
{
  "id": "507f1f77bcf86cd799439012",
  "userId": "507f1f77bcf86cd799439011",
  "priceUSD": 0.50,
  "maxCredits": 1000,
  "usedCredits": 250,
  "remainingCredits": 750,
  "services": ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
  "isActive": true,
  "expiresAt": "2024-12-31T23:59:59.000Z",
  "description": "Partner pricing for Q4 2024",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "secretsCount": 250
}
```

**Response Fields:**
- All standard price override fields
- `secretsCount` (number): Number of payment secrets generated using this override

---

### Update Price Override

Update a price override. Only certain fields can be updated.

**Endpoint:** `PATCH /admin/payments/human-id-credits/price-overrides/:id`

**Path Parameters:**
- `id` (string, required): Price override ID (MongoDB ObjectId)

**Request Body:**
```json
{
  "maxCredits": 2000,
  "isActive": true,
  "expiresAt": "2025-12-31T23:59:59.000Z",
  "description": "Updated partner pricing"
}
```

**Updatable Fields:**
- `maxCredits` (number, optional): Must be a positive integer, cannot be less than `usedCredits`
- `isActive` (boolean, optional): Whether the override is active
- `expiresAt` (string|null, optional): ISO 8601 date string (must be in the future) or `null` to remove expiration
- `description` (string, optional): Internal note

**Fields That Cannot Be Updated:**
- `userId` - Cannot be changed (create a new override instead)
- `priceUSD` - Cannot be changed (create a new override instead)
- `services` - Cannot be changed (create a new override instead)
- `usedCredits` - Automatically managed by the system

**Response:** `200 OK`
```json
{
  "id": "507f1f77bcf86cd799439012",
  "userId": "507f1f77bcf86cd799439011",
  "priceUSD": 0.50,
  "maxCredits": 2000,
  "usedCredits": 250,
  "remainingCredits": 1750,
  "services": ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"],
  "isActive": true,
  "expiresAt": "2025-12-31T23:59:59.000Z",
  "description": "Updated partner pricing",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

---

### Delete Price Override

Delete (deactivate) a price override. This is a soft delete that sets `isActive` to `false`.

**Endpoint:** `DELETE /admin/payments/human-id-credits/price-overrides/:id`

**Path Parameters:**
- `id` (string, required): Price override ID (MongoDB ObjectId)

**Example Request:**
```
DELETE /admin/payments/human-id-credits/price-overrides/507f1f77bcf86cd799439012
```

**Response:** `200 OK`
```json
{
  "message": "Price override deactivated (soft delete)",
  "id": "507f1f77bcf86cd799439012",
  "isActive": false
}
```
