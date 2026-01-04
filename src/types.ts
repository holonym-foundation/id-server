import { Model, Types } from 'mongoose';

export type OnfidoCheck = {
  id: string;
  report_ids: string[];
  status: string;
  result: string
};

export type OnfidoReport = {
  id: string;
  name: string;
  result: string;
  status: string;
  properties: {
    issuing_country?: string;
    device?: {
      ip_reputation?: string;
      device_fingerprint_reuse?: number;
    };
    ip?: {
      address?: string;
    };
  };
  breakdown?: {
    [key: string]: {
      result: string;
      breakdown: {
        [key: string]: {
          result: string;
          details?: string;
          properties?: {
            [key: string]: string;
          };
        };
      };
    };
  };
};

export type OnfidoDocumentReport = OnfidoReport & {
  properties: {
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    date_of_birth?: string;
    expiry_date?: string;
    issuing_country?: string;
    document_type?: string;
    document_number?: string;
    barcode?: Array<{
      middle_name?: string;
    }>;
    city?: string;
    state?: string;
    houseNumber?: string;
    street?: string;
    unit?: string;
    postcode?: string;
    created_at?: string;
  }
}

// ---------------- MongoDB schemas ----------------

export type IUserVerifications = {
  _id?: Types.ObjectId;
  govId?: {
    uuid?: string;
    uuidV2?: string;
    sessionId?: string;
    issuedAt?: Date;
  };
  aml?: {
    uuid?: string;
    issuedAt?: Date;
  };
  biometrics?: {
    uuidV2?: string;
    sessionId?: string;
    issuedAt?: Date;
  };
};

export type IIdvSessions = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  veriff?: {
    sessions?: Array<{
      sessionId?: string;
      createdAt?: Date;
    }>;
  };
  idenfy?: {
    sessions?: Array<{
      scanRef?: string;
      createdAt?: Date;
    }>;
  };
  onfido?: {
    checks?: Array<{
      check_id?: string;
      status?: string; // 'in_progress', 'awaiting_applicant', 'complete', 'withdrawn', 'paused', 'reopened'
      result?: string; // 'clear', 'consider'
      report_ids?: string[];
      webhookReceivedAt?: Date; // When webhook last updated this check
      lastPolledAt?: Date; // When we last polled Onfido API as fallback
      createdAt?: Date;
    }>;
  };
};

export type ISandboxIdvSessions = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  onfido?: {
    checks?: Array<{
      check_id?: string;
      status?: string; // 'in_progress', 'awaiting_applicant', 'complete', 'withdrawn', 'paused', 'reopened'
      result?: string; // 'clear', 'consider'
      report_ids?: string[];
      webhookReceivedAt?: Date; // When webhook last updated this check
      lastPolledAt?: Date; // When we last polled Onfido API as fallback
      createdAt?: Date;
    }>;
  };
};

export type ISession = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  idvProvider?: string;
  status?: string;
  frontendDomain?: string;
  silkDiffWallet?: string;
  deletedFromIDVProvider?: boolean;
  payPal?: {
    orders?: Array<{
      id?: string;
      createdAt?: Date;
    }>;
  };
  txHash?: string;
  chainId?: number;
  refundTxHash?: string;
  sessionId?: string;
  veriffUrl?: string;
  scanRef?: string;
  idenfyAuthToken?: string;
  applicant_id?: string;
  check_id?: string;
  check_status?: string;
  check_result?: string;
  check_report_ids?: string[];
  check_last_updated_at?: Date;
  onfido_sdk_token?: string;
  num_facetec_liveness_checks?: number;
  externalDatabaseRefID?: string;
  verificationFailureReason?: string;
  ipCountry?: string;
  campaignId?: string;
  workflowId?: string;
};

export type ISandboxSession = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  idvProvider?: string;
  status?: string;
  deletedFromIDVProvider?: boolean;
  txHash?: string;
  chainId?: number;
  refundTxHash?: string;
  applicant_id?: string;
  check_id?: string;
  check_status?: string;
  check_result?: string;
  check_report_ids?: string[];
  check_last_updated_at?: Date;
  onfido_sdk_token?: string;
  verificationFailureReason?: string;
  ipCountry?: string;
  campaignId?: string;
  workflowId?: string;
};

export type IAmlChecksSession = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  status?: string;
  silkDiffWallet?: string;
  deletedFromIDVProvider?: boolean;
  payPal?: {
    orders?: Array<{
      id?: string;
      createdAt?: Date;
    }>;
  };
  txHash?: string;
  chainId?: number;
  refundTxHash?: string;
  veriffSessionId?: string;
  verificationFailureReason?: string;
  userDeclaration?: {
    statement?: string;
    confirmed?: boolean;
    statementGeneratedAt?: Date;
  };
};

export type ISandboxAmlChecksSession = IAmlChecksSession;

export type IBiometricsSession = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  status?: string;
  silkDiffWallet?: string;
  ipCountry?: string;
  externalDatabaseRefID?: string;
  verificationFailureReason?: string;
  num_facetec_liveness_checks?: number;
};

export type ISessionRefundMutex = {
  _id?: Types.ObjectId;
  sessionId?: string;
};

export type IUserCredentials = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  proofDigest?: string;
  encryptedCredentials?: string;
  encryptedSymmetricKey?: string;
  encryptedCredentialsAES?: string;
};

export type IUserCredentialsV2 = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  encryptedPhoneCreds?: {
    ciphertext?: string;
    iv?: string;
  };
  encryptedGovIdCreds?: {
    ciphertext?: string;
    iv?: string;
  };
  encryptedCleanHandsCreds?: {
    ciphertext?: string;
    iv?: string;
  };
  encryptedBiometricsCreds?: {
    ciphertext?: string;
    iv?: string;
  };
  encryptedBiometricsAllowSybilsCreds?: {
    ciphertext?: string;
    iv?: string;
  };
};

export type ISandboxUserCredentialsV2 = IUserCredentialsV2

export type IUserProofMetadata = {
  _id?: Types.ObjectId;
  sigDigest?: string;
  encryptedProofMetadata?: string;
  encryptedSymmetricKey?: string;
  encryptedProofMetadataAES?: string;
};

export type INullifierAndCreds = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  issuanceNullifier?: string;
  idvSessionIds?: {
    veriff?: {
      sessionId?: string;
    };
    onfido?: {
      check_id?: string;
    };
    facetec?: {
      externalDatabaseRefID?: string;
    };
  };
  uuidV2?: string;
};

export type ISandboxNullifierAndCreds = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  issuanceNullifier?: string;
  idvSessionIds?: {
    onfido?: {
      check_id?: string;
    };
  };
  uuidV2?: string;
};

export type ICleanHandsNullifierAndCreds = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  issuanceNullifier?: string;
  govIdCreds?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    expiry?: Date;
  };
  idvSessionId?: string;
  uuid?: string;
};

export type ISandboxCleanHandsNullifierAndCreds = ICleanHandsNullifierAndCreds;

export type IBiometricsNullifierAndCreds = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  issuanceNullifier?: string;
  idvSessionIds?: {
    facetec?: {
      externalDatabaseRefID?: string;
    };
  };
  uuidV2?: string;
};

export type IEncryptedNullifiers = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  govId?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  phone?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  cleanHands?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  biometrics?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
};

export type ISandboxEncryptedNullifiers = {
  _id?: Types.ObjectId;
  holoUserId?: string;
  govId?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  phone?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  cleanHands?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
  biometrics?: {
    encryptedNullifier?: {
      ciphertext?: string;
      iv?: string;
    };
    createdAt?: Date;
  };
};

export type IDailyVerificationCount = {
  _id?: Types.ObjectId;
  date: string;
  veriff?: {
    sessionCount?: number;
  };
  idenfy?: {
    sessionCount?: number;
  };
  onfido?: {
    applicantCount?: number;
    checkCount?: number;
  };
};

export type IDailyVerificationDeletions = {
  _id?: Types.ObjectId;
  date: string;
  deletionCount?: number;
};

export type IVerificationCollisionMetadata = {
  _id?: Types.ObjectId;
  uuid?: string;
  uuidV2?: string;
  timestamp?: Date;
  sessionId?: string;
  scanRef?: string;
  check_id?: string;
  uuidConstituents?: {
    firstName?: {
      populated?: boolean;
    };
    lastName?: {
      populated?: boolean;
    };
    postcode?: {
      populated?: boolean;
    };
    address?: {
      populated?: boolean;
    };
    dateOfBirth?: {
      populated?: boolean;
    };
  };
};

export type IGalxeCampaignZeroUser = {
  _id?: Types.ObjectId;
  generatedLink?: string;
  peanutLink?: string;
  email?: string;
};

export type ISilkPeanutCampaignsMetadata = {
  _id?: Types.ObjectId;
  generatedLink?: string;
  peanutLink?: string;
  email?: string;
  campaignId?: string;
};

export type IOrder = {
  _id?: Types.ObjectId;
  holoUserId: string;
  externalOrderId: string;
  category: string;
  fulfilled: boolean;
  fulfillmentReceipt?: string;
  txHash?: string;
  chainId?: number;
  refunded?: boolean;
  refundTxHash?: string;
  stellar?: {
    txHash?: string;
    refundTxHash?: string;
  };
  sui?: {
    txHash?: string;
    refundTxHash?: string;
  };
};

export type ISandboxOrder = IOrder

export type ISanctionsResult = {
  _id?: Types.ObjectId;
  message: string;
  data_source?: {
    short_name?: string;
    long_name?: string;
  };
  nationality?: string[];
  confidence_score?: string;
  si_identifier?: string;
};

export type IHumanIDPaymentGateWhitelist = {
  _id?: Types.ObjectId;
  address: string;
  chain: string;
  reason: string;
};

export type ICleanHandsSessionWhitelist = {
  _id?: Types.ObjectId;
  sessionId: string;
  reason: string;
};

export type ISessionRetryWhitelist = {
  _id?: Types.ObjectId;
  address: string;  // Blockchain address (e.g., Ethereum address)
  tier: number;     // Rate limit tier (e.g., 1 = 15 requests, 2 = 20 requests, etc.)
};

export type IPaymentRedemption = {
  _id?: Types.ObjectId;
  commitmentId?: Types.ObjectId;  // NEW: Reference to PaymentCommitments (optional during migration)
  redeemedAt?: Date;   // When the payment was redeemed
  service?: string;    // Service identifier (bytes32)
  fulfillmentReceipt?: string;  // Receipt from verifier-server when SBT is minted
};

export type ISandboxPaymentRedemption = IPaymentRedemption;

export type IPaymentSecret = {
  _id?: Types.ObjectId;
  encryptedSecret: {
    ciphertext: string;
    iv: string;
  };  // Encrypted payment secret
  commitmentId?: Types.ObjectId;  // Reference to PaymentCommitment document
  holoUserId: string;  // Holonym user ID
  createdAt?: Date;  // When the secret was created/stored
};

export type ISandboxPaymentSecret = IPaymentSecret;

// Human ID Credits types
export type IPaymentCommitment = {
  _id?: Types.ObjectId;
  commitment: string;  // bytes32 commitment hash (unique, indexed)
  sourceType: 'user' | 'credits';  // Where this commitment came from
  createdAt: Date;
};

export type ISandboxPaymentCommitment = IPaymentCommitment;

export type IHumanIDCreditsUser = {
  _id?: Types.ObjectId;
  walletAddress: string;  // Wallet that signs SIWE messages (indexed)
  name?: string;  // Optional organization name
  createdAt: Date;
};

export type ISandboxHumanIDCreditsUser = IHumanIDCreditsUser;

export type IHumanIDCreditsPaymentSecret = {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;  // Reference to HumanIDCreditsUsers
  commitmentId: Types.ObjectId;  // Reference to PaymentCommitments (not commitment string)
  secret: string;  // Plaintext secret
  chainId: number;
  price: string;  // Price in wei
  createdAt: Date;
};

export type ISandboxHumanIDCreditsPaymentSecret = IHumanIDCreditsPaymentSecret;

// ---------------- MongoDB schemas for direct verification service ----------------

export namespace DirectVerification {
  export type ICustomer = {
    _id?: Types.ObjectId;
    name: string;
  };

  export type IAPIKey = {
    _id?: Types.ObjectId;
    customerId: Types.ObjectId
    key: string
  }

  // A customer purchases credits with an order. paymentDetails specifies what they
  // paid us, and credits specifies what they purchased.
  // Not to be confused with orders for our "orders API".
  export type IOrder = {
    _id?: Types.ObjectId;
    customerId: Types.ObjectId;
    // paymentDetails?: {
    //   amount?: string // e.g., '100'
    //   denomination?: string // e.g., 'USD'
    // };
    credits: number
  };

  // NOT TO BE CONFUSED WITH STANDARD Human ID sessions. This session type is exclusively
  // for the Direct Verification (non-web3) service.
  export type ISession = {
    _id?: Types.ObjectId;
    // customerId is inferred by API key at time of session creation
    customerId: Types.ObjectId;
    // userId is supplied by integrator before session creation
    userId: string;
    status: 'IN_PROGRESS' | 'ENROLLED' | 'PASSED_AGE_VERIFICATION' | 'VERIFICATION_FAILED'
  };
}

export type SandboxVsLiveKYCRouteHandlerConfig = {
  environment: "sandbox" | "live";
  onfidoAPIKey: string
  onfidoWebhookToken: string
  SessionModel: Model<ISession | ISandboxSession>
  IDVSessionsModel: Model<IIdvSessions | ISandboxIdvSessions>
  NullifierAndCredsModel: Model<INullifierAndCreds | ISandboxNullifierAndCreds>
  UserCredentialsV2Model: Model<IUserCredentialsV2 | ISandboxUserCredentialsV2>
  EncryptedNullifiersModel: Model<IEncryptedNullifiers | ISandboxEncryptedNullifiers>
  OrderModel: Model<IOrder | ISandboxOrder>
  AMLChecksSessionModel: Model<IAmlChecksSession | ISandboxAmlChecksSession>
  CleanHandsNullifierAndCredsModel: Model<ICleanHandsNullifierAndCreds | ISandboxCleanHandsNullifierAndCreds>
  SanctionsResultModel: Model<ISanctionsResult>
  PaymentRedemptionModel: Model<IPaymentRedemption | ISandboxPaymentRedemption>
  PaymentSecretModel: Model<IPaymentSecret | ISandboxPaymentSecret>
  PaymentCommitmentModel: Model<IPaymentCommitment | ISandboxPaymentCommitment>
  issuerPrivateKey: string
  cleanHandsIssuerPrivateKey: string
}
