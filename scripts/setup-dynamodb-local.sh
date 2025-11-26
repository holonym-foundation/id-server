#!/bin/bash

# Script to create DynamoDB tables and indexes for local development
# Requires DynamoDB Local to be running on http://localhost:8000

set -e  # Exit on error

if [ -f .env ]; then
  export $(grep AWS_DYNAMODB_ACCESS_KEY_ID .env | xargs)
  export $(grep AWS_DYNAMODB_SECRET_ACCESS_KEY .env | xargs)
else
  echo ".env file not found! Please ensure it exists in the current directory."
  exit 1
fi


ENDPOINT_URL="http://localhost:8000"

# Check if DynamoDB Local is running
if ! nc -z localhost 8000; then
  echo "Error: DynamoDB Local does not appear to be running on port 8000."
  echo "Please start DynamoDB Local before running this script."
  exit 1
fi


echo "Creating DynamoDB tables and indexes for local development..."
echo "Endpoint: $ENDPOINT_URL"
echo ""

# phone-numbers table
echo "Creating phone-numbers table..."
aws dynamodb create-table \
  --endpoint-url $ENDPOINT_URL \
  --table-name phone-numbers \
  --attribute-definitions AttributeName=phoneNumber,AttributeType=S \
  --key-schema AttributeName=phoneNumber,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  Table may already exist (skipping)"
echo "  ✓ phone-numbers"

# phone-sessions table with indexes
echo "Creating phone-sessions table..."
aws dynamodb create-table \
  --endpoint-url $ENDPOINT_URL \
  --table-name phone-sessions \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=sigDigest,AttributeType=S \
    AttributeName=txHash,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    'IndexName=sigDigest-index,KeySchema=[{AttributeName=sigDigest,KeyType=HASH}],Projection={ProjectionType=ALL}' \
    'IndexName=txHash-index,KeySchema=[{AttributeName=txHash,KeyType=HASH}],Projection={ProjectionType=ALL}' \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  Table may already exist (skipping)"
echo "  ✓ phone-sessions"

# sandbox-phone-sessions table with indexes
echo "Creating sandbox-phone-sessions table..."
aws dynamodb create-table \
  --endpoint-url $ENDPOINT_URL \
  --table-name sandbox-phone-sessions \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=sigDigest,AttributeType=S \
    AttributeName=txHash,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    'IndexName=sigDigest-index,KeySchema=[{AttributeName=sigDigest,KeyType=HASH}],Projection={ProjectionType=ALL}' \
    'IndexName=txHash-index,KeySchema=[{AttributeName=txHash,KeyType=HASH}],Projection={ProjectionType=ALL}' \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  Table may already exist (skipping)"
echo "  ✓ sandbox-phone-sessions"

# vouchers table with index
echo "Creating vouchers table..."
aws dynamodb create-table \
  --endpoint-url $ENDPOINT_URL \
  --table-name vouchers \
  --attribute-definitions \
    AttributeName=id,AttributeType=S \
    AttributeName=txHash,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --global-secondary-indexes \
    'IndexName=txHash-index,KeySchema=[{AttributeName=txHash,KeyType=HASH}],Projection={ProjectionType=ALL}' \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  Table may already exist (skipping)"
echo "  ✓ vouchers"

# phone-nullifier-and-creds table
echo "Creating phone-nullifier-and-creds table..."
aws dynamodb create-table \
  --endpoint-url $ENDPOINT_URL \
  --table-name phone-nullifier-and-creds \
  --attribute-definitions AttributeName=issuanceNullifier,AttributeType=S \
  --key-schema AttributeName=issuanceNullifier,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  > /dev/null 2>&1 || echo "  Table may already exist (skipping)"
echo "  ✓ phone-nullifier-and-creds"

echo ""
echo "Done! All tables and indexes have been created."
echo ""
echo "Waiting for tables to be active..."
sleep 2

# Verify tables exist
echo "Verifying tables..."
for table in phone-numbers phone-sessions sandbox-phone-sessions vouchers phone-nullifier-and-creds; do
  if aws dynamodb describe-table --endpoint-url $ENDPOINT_URL --table-name $table > /dev/null 2>&1; then
    echo "  ✓ $table is ready"
  else
    echo "  ✗ $table failed to create"
  fi
done

