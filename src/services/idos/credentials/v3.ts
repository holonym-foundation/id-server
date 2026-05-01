import { Request, Response } from "express";
import { ObjectId } from "mongodb";

import { getRouteHandlerConfig, UserVerifications } from "../../../init.js";
import { pinoOptions, logger } from "../../../utils/logger.js";
import { sessionStatusEnum } from "../../../constants/misc.js";
import {
  dateElevenMonthsAgo,
  dateElevenMonthsFromNow,
  govIdUUID,
} from "../../../utils/utils.js";
import { findUserVerification } from "../../../utils/user-verifications.js";
import { findOneNullifierAndCredsLast5Days } from "../../../utils/nullifier-and-creds.js";
import { failSession } from "../../../utils/sessions.js";
import { issuev2KYC } from "../../../utils/issuance.js";
import {
  toAlreadyRegisteredStr,
  makeUnknownErrorLoggable,
} from "../../../utils/errors.js";
import type { SandboxVsLiveKYCRouteHandlerConfig } from "../../../types.js";

import {
  listGrants,
  decryptCredential,
  getSharedCredential,
} from "../consumer.js";
import { getAllowedIssuers } from "../issuers.js";
import { extractCreds, type IdosVerifiableCredential } from "./utils.js";

const endpointLogger = logger.child({
  msgPrefix: "[GET /idos/credentials/v3] ",
  base: {
    ...pinoOptions.base,
    idvProvider: "idos",
    feature: "holonym",
    subFeature: "gov-id",
  },
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IdosGrantLite {
  id: string;
  ag_owner_user_id: string;
  ag_grantee_wallet_identifier: string;
  data_id: string;
}

/**
 * Page through `listGrants` until a grant with `data_id == dataId` shows up,
 * or we've exhausted the consumer's grant list. Page size is intentionally
 * large to keep the common case to a single round-trip; pagination is here
 * to bound memory if the consumer has accumulated many grants over time.
 */
async function findGrantByDataId(
  dataId: string
): Promise<IdosGrantLite | undefined> {
  const PAGE_SIZE = 100;
  for (let page = 1; page <= 50; page += 1) {
    const { grants, totalCount } = await listGrants({
      page,
      size: PAGE_SIZE,
    });
    const match = (grants as IdosGrantLite[]).find((g) => g.data_id === dataId);
    if (match) return match;
    if (page * PAGE_SIZE >= totalCount) return undefined;
  }
  return undefined;
}

function createGetCredentialsV3(config: SandboxVsLiveKYCRouteHandlerConfig) {
  return async (req: Request, res: Response) => {
    try {
      const _id = req.params._id;
      const issuanceNullifier = req.params.nullifier;

      try {
        BigInt(issuanceNullifier);
      } catch {
        return res.status(400).json({
          error: `Invalid issuance nullifier (${issuanceNullifier}). It must be a number`,
        });
      }

      let objectId: ObjectId;
      try {
        objectId = new ObjectId(_id);
      } catch {
        return res.status(400).json({ error: "Invalid _id" });
      }

      const session = await config.SessionModel.findOne({
        _id: objectId,
      }).exec();
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status === sessionStatusEnum.VERIFICATION_FAILED) {
        return res.status(400).json({
          error: `Verification failed. Reason(s): ${session.verificationFailureReason}`,
        });
      }

      // 5-day nullifier replay path: if the user is asking for the same
      // nullifier we already issued for, return the cached path.
      const nullifierAndCreds = await findOneNullifierAndCredsLast5Days(
        config.NullifierAndCredsModel,
        issuanceNullifier
      );
      const cachedDataId = nullifierAndCreds?.idvSessionIds?.idos?.dataId;
      if (cachedDataId) {
        const cachedContent = await decryptCredential(cachedDataId);
        const cachedVc = JSON.parse(cachedContent) as IdosVerifiableCredential;
        const cachedExtracted = extractCreds(cachedVc);
        const cachedResponse = issuev2KYC(
          config.issuerPrivateKey,
          issuanceNullifier,
          cachedExtracted
        );
        cachedResponse.metadata = cachedExtracted;

        endpointLogger.info(
          { uuidV2: nullifierAndCreds?.uuidV2, dataId: cachedDataId },
          "Re-issuing credentials from nullifier cache"
        );

        await config.SessionModel.updateOne(
          { _id: objectId },
          { $set: { status: sessionStatusEnum.ISSUED } }
        ).exec();

        return res.status(200).json(cachedResponse);
      }

      // The session must be in the IN_PROGRESS state to consume a grant. ISSUED
      // sessions should have hit the nullifier-cache branch above.
      if (session.status !== sessionStatusEnum.IN_PROGRESS) {
        return res.status(400).json({
          error: `Session status is '${session.status}'. Expected '${sessionStatusEnum.IN_PROGRESS}'`,
        });
      }

      const dataIdRaw =
        typeof req.query.dataId === "string" ? req.query.dataId : undefined;
      const userAddressRaw =
        typeof req.query.userAddress === "string"
          ? req.query.userAddress
          : undefined;
      if (!dataIdRaw || !UUID_RE.test(dataIdRaw)) {
        return res.status(400).json({
          error: "Query param 'dataId' must be the UUID of the granted credential",
        });
      }
      if (!userAddressRaw || !/^0x[0-9a-fA-F]{40}$/.test(userAddressRaw)) {
        return res.status(400).json({
          error:
            "Query param 'userAddress' must be a 0x-prefixed 20-byte hex string",
        });
      }

      // Fail closed if no allowed issuers are configured: better to return a
      // clear server-config error than to silently accept any issuer.
      let allowedIssuers;
      try {
        allowedIssuers = getAllowedIssuers();
      } catch (err) {
        endpointLogger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Allowed-issuers configuration missing/invalid"
        );
        return res.status(500).json({
          error:
            "idOS issuer trust list is not configured on this server",
        });
      }

      // userAddressRaw is logged for traceability but not used as a filter:
      // grant existence is the authoritative authorization signal, and the
      // SDK's `getAccessGrants` only returns grants given to *our* consumer.
      // Kept as a required query param so a misconfigured frontend fails
      // loudly here rather than silently mixing addresses on the backend.
      endpointLogger.info(
        { sessionId: _id, dataId: dataIdRaw, userAddress: userAddressRaw },
        "Resolving idOS grant"
      );

      const grant = await findGrantByDataId(dataIdRaw);
      if (!grant) {
        // No grant yet → user hasn't completed the idOS access-grant flow.
        // Return 404 *without* failing the session so the frontend can retry.
        return res.status(404).json({
          error:
            "No idOS grant found for this dataId yet. Complete the access grant in the verify step and retry.",
        });
      }

      // Decrypt + parse + issuer-verify before normalizing fields. We trust
      // none of the credential's contents until verifyCredential succeeds.
      const decryptedJson = await decryptCredential(grant.data_id);
      let vc: IdosVerifiableCredential;
      try {
        vc = JSON.parse(decryptedJson) as IdosVerifiableCredential;
      } catch (err) {
        endpointLogger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Decrypted idOS credential was not valid JSON"
        );
        return res.status(400).json({
          error: "Decrypted idOS credential payload was not valid JSON",
        });
      }

      // Issuer trust check: pull the on-chain credential record (which
      // carries `issuer_auth_public_key`) and require it match an entry in
      // our configured allow-list. Done before extractCreds so we never
      // hash fields from a credential we don't trust.
      try {
        const onIdos = await getSharedCredential(grant.data_id);
        if (!onIdos) {
          return res.status(404).json({
            error:
              "Granted idOS credential could not be retrieved. The grant may have been revoked.",
          });
        }
        const trustedKeys = (allowedIssuers as Array<{
          publicKeyMultibase?: string;
        }>)
          .map((i) => i.publicKeyMultibase)
          .filter((k): k is string => typeof k === "string");
        if (
          trustedKeys.length === 0 ||
          !trustedKeys.includes(onIdos.issuer_auth_public_key)
        ) {
          endpointLogger.warn(
            {
              dataId: grant.data_id,
              issuerAuthPublicKey: onIdos.issuer_auth_public_key,
            },
            "Rejecting idOS credential signed by an unknown issuer"
          );
          return res.status(400).json({
            error:
              "idOS credential is signed by an issuer not in the trust list",
          });
        }
      } catch (err) {
        endpointLogger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to verify idOS credential issuer"
        );
        return res.status(400).json({
          error: "Failed to verify idOS credential issuer",
        });
      }

      const creds = extractCreds(vc);

      // Sybil resistance: same UUID derivation as Onfido (firstName +
      // lastName + dob).
      const uuidNew = govIdUUID(
        creds.rawCreds.firstName,
        creds.rawCreds.lastName,
        creds.rawCreds.birthdate
      );

      if (config.environment === "live") {
        const user = await findUserVerification(uuidNew, "govId", {
          issuedAt: { after: dateElevenMonthsAgo() },
          expiresAt: { after: new Date() },
        });
        if (user) {
          await failSession(session, toAlreadyRegisteredStr(user._id.toString()));
          return res
            .status(400)
            .json({ error: toAlreadyRegisteredStr(user._id.toString()) });
        }
      }

      // Persist the user verification before issuing so a duplicate request
      // can't slip through a race.
      try {
        await new UserVerifications({
          govId: {
            uuidV2: uuidNew,
            sessionId: _id,
            issuedAt: new Date(),
            expiresAt: dateElevenMonthsFromNow(),
          },
        }).save();
      } catch (err) {
        endpointLogger.error(
          { error: err },
          "Failed to save UserVerifications row for idOS issuance"
        );
        return res.status(500).json({
          error:
            "An error occurred while trying to save object to database. Please try again.",
        });
      }

      const response = issuev2KYC(
        config.issuerPrivateKey,
        issuanceNullifier,
        creds
      );
      response.metadata = creds;

      endpointLogger.info(
        { uuidV2: uuidNew, dataId: grant.data_id, sessionId: _id },
        "Issuing credentials"
      );

      // Associate the dataId with the nullifier so the 5-day replay path
      // works on retries.
      await new config.NullifierAndCredsModel({
        holoUserId: session.sigDigest,
        issuanceNullifier,
        uuidV2: uuidNew,
        idvSessionIds: {
          idos: {
            dataId: grant.data_id,
          },
        },
      }).save();

      session.status = sessionStatusEnum.ISSUED;
      await session.save();

      return res.status(200).json(response);
    } catch (err: unknown) {
      endpointLogger.error(
        { error: makeUnknownErrorLoggable(err) },
        "Unexpected error in idOS credentials/v3"
      );
      return res.status(500).json({ error: "An unexpected error occurred." });
    }
  };
}

export async function getCredentialsV3Prod(req: Request, res: Response) {
  return createGetCredentialsV3(getRouteHandlerConfig("live"))(req, res);
}

export async function getCredentialsV3Sandbox(req: Request, res: Response) {
  return createGetCredentialsV3(getRouteHandlerConfig("sandbox"))(req, res);
}
