import { ethers } from "ethers";
import { VeraxSdk } from "@verax-attestation-registry/verax-sdk";
import {
  optimismProvider,
  defaultActionId,
  kycIssuerAddress,
  phoneIssuerAddress,
  v3KYCSybilResistanceCircuitId,
  v3PhoneSybilResistanceCircuitId,
  // v3EPassportSybilResistanceCircuitId 
} from "../../constants/misc.js";
import HubV3ABI from "../../constants/abi/HubV3ABI.js";
import contractAddresses from "../../constants/contractAddresses.js";
import logger from "../../utils/logger.js";

const postEndpointLogger = logger.child({
  msgPrefix: "[POST /admin/issue-verax-attestation] ",
});

const veraxSdk = new VeraxSdk(
  VeraxSdk.DEFAULT_LINEA_MAINNET,
  // address,
  '0xB1f50c6C34C72346b1229e5C80587D0D659556Fd',
  // privateKey
  process.env.RELAYER_PRIVATE_KEY
);

const hubV3Address = contractAddresses.HubV3.mainnet.optimism;

/**
 * @param subject Should be user's address
 */
function getAttestations(subject) {
  return veraxSdk.attestation.findBy(
    undefined,
    undefined,
    {
      // Holonym's schemaId
      schemaId: "0x1c14fd320660a59a50eb1f795116193a59c26f2463c0705b79d8cb97aa9f419b",
      // Our relayer/attester
      attester: "0xB1f50c6C34C72346b1229e5C80587D0D659556Fd",
      // Our address of interest
      subject,
    }
  );
}

function validateKYCAttestation(attestation) {
  const { circuitId, publicValues, revoked } = attestation.decodedPayload[0]
  
  const actionId = publicValues[2].toString();
  const issuer = publicValues[4];
  
  // Make sure circuitId matches KYC circuit ID
  if (circuitId != v3KYCSybilResistanceCircuitId) {
    return {
      error: "Invalid circuit ID"
    }
  }
  
  // Validate action ID
  if (actionId != defaultActionId.toString()) {
    return {
      error: "Invalid action ID"
    }
  }
  
  // Make sure issuer is the KYC Holonym issuer
  if (issuer != BigInt(kycIssuerAddress)) {
    return {
      error: "Invalid KYC issuer"
    }
  }
}

function validatePhoneAttestation(attestation) {
  const { circuitId, publicValues, revoked } = attestation.decodedPayload[0]
  
  const actionId = publicValues[2].toString();
  const issuer = publicValues[4];
  
  // Make sure circuitId matches phone circuit ID
  if (circuitId != v3PhoneSybilResistanceCircuitId) {
    return {
      error: "Invalid circuit ID"
    }
  }
  
  // Validate action ID
  if (actionId != defaultActionId.toString()) {
    return {
      error: "Invalid action ID"
    }
  }
  
  // Make sure issuer is the phone Holonym issuer
  if (issuer != BigInt(phoneIssuerAddress)) {
    return {
      error: "Invalid phone issuer"
    }
  }
}

async function getAndValidateV3SBT(address, circuitId, issuerAddress) {
  const hubV3Contract = new ethers.Contract(hubV3Address, HubV3ABI, optimismProvider);

  // Check v3 contract for SBT
  const sbt = await hubV3Contract.getSBT(address, circuitId);

  const publicValues = sbt[1];
  const actionIdInSBT = publicValues[2].toString();
  const issuerAddressInSBT = publicValues[4].toHexString();

  const actionIdIsValid = defaultActionId.toString() == actionIdInSBT;
  const issuerIsValid = issuerAddress == issuerAddressInSBT;

  if (actionIdIsValid && issuerIsValid) {
    return sbt;
  }
}

function getAndValidateV3KYCSBT(address) {
  return getAndValidateV3SBT(address, v3KYCSybilResistanceCircuitId, kycIssuerAddress);
}

function getAndValidateV3PhoneSBT(address) {
  return getAndValidateV3SBT(address, v3PhoneSybilResistanceCircuitId, phoneIssuerAddress);
}

function getSBT(address, attestationType) {
  if (attestationType == 'kyc') {
    return getAndValidateV3KYCSBT(address);
  }

  if (attestationType == 'phone') {
    return getAndValidateV3PhoneSBT(address);
  }
}

async function attest(subject, circuitId, publicValues, revoked) {
  // Old address. Has attestation replacement vulnerability.
  // const portalAddr = "0x5631Aecf3283922b6bf36D7485Eb460f244bfac1"
  // v2. Fixes replacement vulnerability.
  // const portalAddr = "0xFa0FFfDc21476245cd8a667DAec4E049eb5337Db"
  // v3
  const portalAddr = "0x3d2F5e17e365CE495df340a341755EFA6F4f553c"
  const schemaId = "0x1c14fd320660a59a50eb1f795116193a59c26f2463c0705b79d8cb97aa9f419b"
  const expiry = Math.floor(BigInt(publicValues[0]).toString());
  await veraxSdk.portal.attest(
    portalAddr,
    {
      schemaId,
      expirationDate: expiry,
      subject,
      // (string circuitId, uint256[] publicValues, bool revoked)
      attestationData: [{ 
        circuitId: circuitId,
        publicValues: publicValues,
        revoked: revoked
      }],
    },
    []
  )
}

/**
 * ENDPOINT.
 */
async function issueVeraxAttestation(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const address = req.body.address;
    const attestationType = req.body.attestationType;

    if (['kyc', 'phone'].indexOf(attestationType) === -1) {
      return res.status(400).json({ error: "Invalid attestation type" });
    }

    // ---------- Make sure user doesn't already have this attestation ----------
    const attestations = await getAttestations(address);
    const kycAttestation = attestations.filter(
      (attestation) => attestation.decodedPayload[0].circuitId == v3KYCSybilResistanceCircuitId
    )[0];
    const phoneAttestation = attestations.filter(
      (attestation) => attestation.decodedPayload[0].circuitId == v3PhoneSybilResistanceCircuitId
    )[0];

    if (attestationType == 'kyc' && kycAttestation) {
      const validationResult = validateKYCAttestation(kycAttestation)
      if (!validationResult?.error) {
        return res.status(400).json({ error: "User already has a KYC attestation" });
      }
    }

    if (attestationType == 'phone' && phoneAttestation) {
      const validationResult = validatePhoneAttestation(phoneAttestation)
      if (!validationResult?.error) {
        return res.status(400).json({ error: "User already has a phone attestation" });
      }
    }
    
    // ---------- Make sure user has the required SBT ----------
    let sbt;
    try {
      sbt = await getSBT(address, attestationType);
  
      if (!sbt) {
        return res.status(400).json({ error: "User does not have the required SBT" });
      }
    } catch (err) {
      if ((err.errorArgs?.[0] ?? "").includes("SBT is expired")) {
        return res.status(400).json({ error: err.errorArgs?.[0] });
      }
    }

    // ---------- Issue attestation ----------
    const publicValues = sbt[1];
    let circuitId = null;
    if (attestationType == 'kyc') {
      circuitId = v3KYCSybilResistanceCircuitId;
    } else if (attestationType == 'phone') {
      circuitId = v3PhoneSybilResistanceCircuitId;
    }
    const revoked = sbt[2];
    await attest(address, circuitId, publicValues, revoked);

    return res.status(200).json({
      message: `Successfully issued ${attestationType} attestation to ${address}`,
    });
  } catch (err) {
    console.log(err)
    postEndpointLogger.error({ error: err });
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}

export { issueVeraxAttestation };
