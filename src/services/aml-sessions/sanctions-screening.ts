import { HydratedDocument } from "mongoose";
import { pinoOptions, logger } from "../../utils/logger.js";
import { upgradeLogger } from "./error-logger.js";
import { CleanHandsSessionWhitelist } from "../../init.js";
import { siIdentifierPrefixesToBlock } from "../../utils/constants.js";
import { parseStatementForUserCertification } from "../../utils/clean-hands-misc.js";
import {
  SandboxVsLiveKYCRouteHandlerConfig,
  ISanctionsResult,
  IAmlChecksSession,
  ISandboxAmlChecksSession,
} from "../../types.js";

/**
 * Shared sanctions.io + PEP screening for the AML (Clean Hands) flow.
 *
 * This is the canonical screening implementation. It is a faithful extraction
 * of the inline block in issueCredsV4 (the production Onfido path) — the query
 * params, PEP-blocking-by-country logic, SanctionsResult persistence, whitelist
 * handling, and statement generation are byte-for-byte identical, so all
 * branches that call it produce the same screening decisions.
 *
 * Currently consumed only by the iDenfy issuance handler. Migrating the Onfido
 * (issueCredsV4) and ZK Passport (verifyAndIssueZkPassport) paths onto this
 * module is deferred to a separate refactor PR so that this feature PR keeps
 * those production paths zero-diff (see the iDenfy Clean Hands plan, U3 /
 * Deferred to Follow-Up Work).
 *
 * Sanctions.io is queried on name + date_of_birth only. `country` is
 * deliberately NOT an input — country_residence is not part of the query in
 * any existing branch; the credential's country lives elsewhere.
 *
 * Side effects: persists PEP hits to SanctionsResultModel and logs matches.
 * It does NOT mutate the session or write an HTTP response — the caller owns
 * session lifecycle (failSession on `blocked`, set NEEDS_USER_DECLARATION +
 * userDeclaration on `declaration-required`) and the HTTP status.
 */

const screeningLogger = upgradeLogger(
  logger.child({
    msgPrefix: "[aml sanctions-screening] ",
    base: {
      ...pinoOptions.base,
      feature: "holonym",
      subFeature: "clean-hands",
    },
  })
);

export type SanctionsScreeningDecision =
  | { outcome: "clear" }
  | { outcome: "blocked"; failureReason: string }
  | { outcome: "declaration-required"; statement: string };

export async function runSanctionsScreening(args: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  session: HydratedDocument<IAmlChecksSession | ISandboxAmlChecksSession>;
  config: SandboxVsLiveKYCRouteHandlerConfig;
}): Promise<SanctionsScreeningDecision> {
  const { firstName, lastName, dateOfBirth, session, config } = args;

  // If a sanctions check was recently done, the user was not on any blocklist,
  // and they were flagged as a potential PEP in a non-high-risk country, the
  // session carries a statement the user can confirm. If they confirmed it
  // recently, skip re-screening.
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const skipSanctionsCheck =
    session.userDeclaration?.confirmed &&
    (session.userDeclaration?.statementGeneratedAt ?? 0) > fiveDaysAgo;

  if (skipSanctionsCheck) {
    return { outcome: "clear" };
  }

  // sanctions.io returns 301 if we query "<base-url>/search" but returns the
  // actual result when we query "<base-url>/search/" (with trailing slash).
  const sanctionsUrl =
    "https://api.sanctions.io/search/" +
    "?min_score=0.93" +
    `&data_source=${encodeURIComponent(
      "CAP,CCMC,CMIC,DPL,DTC,EL,FATF,FBI,FINCEN,FSE,INTERPOL,ISN,MEU,NONSDN,NS-MBS LIST,OFAC-COMPREHENSIVE,OFAC-MILITARY,OFAC-OTHERS,PEP,PLC,SDN,SSI,US-DOS-CRS"
    )}` +
    `&name=${encodeURIComponent(`${firstName} ${lastName}`)}` +
    `&date_of_birth=${encodeURIComponent(dateOfBirth)}` +
    "&entity_type=individual";
  const reqConfig = {
    headers: {
      Accept: "application/json; version=2.2",
      Authorization: "Bearer " + process.env.SANCTIONS_API_KEY,
    },
  };
  const resp = await fetch(sanctionsUrl, reqConfig);
  const data = await resp.json();

  const resultsObjectsToStore: Array<
    HydratedDocument<ISanctionsResult> & { message: string }
  > = [];
  const resultsToBlock = data.results.filter((result: any) => {
    // Keep all non-PEP results
    if (result?.data_source?.short_name !== "PEP") {
      return true;
    }

    // Log and persist the PEP hit
    const resultToLog = {
      data_source: result.data_source,
      nationality: result.nationality,
      confidence_score: result.confidence_score,
      si_identifier: result.si_identifier,
    };
    screeningLogger.info({ result: resultToLog }, "PEP result found");
    const resultsObj = new config.SanctionsResultModel({
      message: "PEP result found",
      ...resultToLog,
    });
    resultsObjectsToStore.push(resultsObj);

    // Block PEP results from certain countries
    for (const prefix of siIdentifierPrefixesToBlock) {
      if (!result.si_identifier) {
        screeningLogger.warn({ result }, "No si_identifier found for PEP result");
        return true;
      }
      if (result.si_identifier?.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  });

  await Promise.all(resultsObjectsToStore.map((result) => result.save()));

  // PEP results that don't trigger an automatic block. For countries we don't
  // block, allow the user to declare they are not the PEP with a similar name.
  const resultsThatRequireDeclaration = data.results.filter((result: any) => {
    // Ignore all non-PEP results
    if (result?.data_source?.short_name !== "PEP") {
      return false;
    }

    // If data_hash is missing for some reason, include it. It should be present.
    if (!result.data_hash) {
      screeningLogger.error(
        { result },
        "Sanctions io PEP result is missing data_hash"
      );
      return true;
    }

    // If this PEP result is already in the results to block, ignore it
    for (const resultToBlock of resultsToBlock) {
      if (resultToBlock.data_hash && result.data_hash === resultToBlock.data_hash) {
        return false;
      } else if (!resultToBlock.data_hash) {
        screeningLogger.error(
          { result: resultToBlock },
          "Sanctions io PEP result is missing data_hash"
        );
        return true;
      }
    }

    return true;
  });

  if (resultsToBlock.length > 0) {
    const whitelistItem = await CleanHandsSessionWhitelist.findOne({
      sessionId: session._id,
    }).exec();
    if (!whitelistItem) {
      screeningLogger.sanctionsMatchFound(data.results);
      const confidenceScores = data?.results
        ?.map((result: any) => {
          return `(${result.data_source?.name}: ${result?.confidence_score})`;
        })
        .join(", ");
      return {
        outcome: "blocked",
        failureReason: `Sanctions match found. Confidence scores: ${confidenceScores}`,
      };
    } else {
      screeningLogger.info(
        { sessionId: session._id },
        "Ignoring sanctions match for whitelisted session"
      );
    }
  }

  if (resultsThatRequireDeclaration.length > 0) {
    const statement = parseStatementForUserCertification(
      resultsThatRequireDeclaration
    );
    return { outcome: "declaration-required", statement };
  }

  return { outcome: "clear" };
}
