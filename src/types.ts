import { Types } from 'mongoose';

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
  onfido_sdk_token?: string;
  num_facetec_liveness_checks?: number;
  externalDatabaseRefID?: string;
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
};

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
