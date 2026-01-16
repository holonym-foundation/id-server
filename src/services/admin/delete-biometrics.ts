import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import axios from "axios";
import {
  BiometricsSession,
  BiometricsAllowSybilsSession,
} from "../../init.js";
import { getFaceTecBaseURL } from "../../utils/facetec.js";
import logger from "../../utils/logger.js";

const endpointLogger = logger.child({
  msgPrefix: "[DELETE /admin/biometrics] ",
});

/**
 * DELETE /admin/biometrics
 * 
 * Deletes biometrics data from FaceTec 3D database.
 * 
 * Query parameters:
 * - id: Session ID (required)
 * - selector: "primary" | "secondary" | "all" (required)
 *   - "primary": Normal Human ID flow (biometrics session collection)
 *   - "secondary": Covenant app flow (biometrics allow sybils collection)
 *   - "all": Query both collections, use first hit
 * 
 * Requires admin API key in X-API-Key header.
 */
export async function deleteBiometrics(req: Request, res: Response) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== process.env.ADMIN_API_KEY_LOW_PRIVILEGE) {
      return res.status(401).json({ error: "Invalid API key." });
    }

    const id: string = req.query.id as string;
    const selector: string = req.query.selector as string;

    if (!id) {
      return res.status(400).json({ error: "id query parameter is required." });
    }

    if (!selector) {
      return res.status(400).json({ error: "selector query parameter is required." });
    }

    if (!["primary", "secondary", "all"].includes(selector)) {
      return res.status(400).json({ 
        error: "selector must be 'primary', 'secondary', or 'all'." 
      });
    }

    // Convert id to ObjectId
    let objectId = null;
    try {
      objectId = new ObjectId(id);
    } catch (err) {
      return res.status(400).json({ error: "Invalid session ID." });
    }

    // Query the initial session using the session ID
    let initialSession = null;
    if (selector === "primary") {
      initialSession = await BiometricsSession.findOne({ _id: objectId }).exec();
    } else if (selector === "secondary") {
      initialSession = await BiometricsAllowSybilsSession.findOne({ _id: objectId }).exec();
    } else if (selector === "all") {
      // Try primary first, then secondary
      initialSession = await BiometricsSession.findOne({ _id: objectId }).exec();
      if (!initialSession) {
        initialSession = await BiometricsAllowSybilsSession.findOne({ _id: objectId }).exec();
      }
    }

    if (!initialSession) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (!initialSession.sigDigest) {
      return res.status(400).json({ 
        error: "Session does not have a sigDigest." 
      });
    }

    // Query all biometrics sessions for this user using sigDigest
    let allUserSessions: any[] = [];
    if (selector === "primary") {
      allUserSessions = await BiometricsSession.find({ 
        sigDigest: initialSession.sigDigest,
        externalDatabaseRefID: { $exists: true }
      }).exec();
    } else if (selector === "secondary") {
      allUserSessions = await BiometricsAllowSybilsSession.find({ 
        sigDigest: initialSession.sigDigest,
        externalDatabaseRefID: { $exists: true }
      }).exec();
    } else if (selector === "all") {
      // Query both collections
      const primarySessions = await BiometricsSession.find({ 
        sigDigest: initialSession.sigDigest,
        externalDatabaseRefID: { $exists: true }
      }).exec();
      const secondarySessions = await BiometricsAllowSybilsSession.find({ 
        sigDigest: initialSession.sigDigest,
        externalDatabaseRefID: { $exists: true }
      }).exec();
      allUserSessions = [...primarySessions, ...secondarySessions];
    }

    // Find the first session that has an externalDatabaseRefID
    const sessionWithExternalRef = allUserSessions.find(
      (s: any) => s.externalDatabaseRefID
    );

    if (!sessionWithExternalRef || !sessionWithExternalRef.externalDatabaseRefID) {
      return res.status(400).json({ 
        error: "No session found with an externalDatabaseRefID for this user." 
      });
    }

    const externalDatabaseRefID = sessionWithExternalRef.externalDatabaseRefID;

    // Search for all matching entries in FaceTec database
    const groupNames: string[] = [];
    if (selector === "primary") {
      if (!process.env.FACETEC_GROUP_NAME_FOR_KYC) {
        return res.status(500).json({ 
          error: "FACETEC_GROUP_NAME_FOR_KYC environment variable not set." 
        });
      }
      groupNames.push(process.env.FACETEC_GROUP_NAME_FOR_KYC);
    } else if (selector === "secondary") {
      if (!process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS) {
        return res.status(500).json({ 
          error: "FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS environment variable not set." 
        });
      }
      groupNames.push(process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS);
    } else if (selector === "all") {
      if (!process.env.FACETEC_GROUP_NAME_FOR_KYC) {
        return res.status(500).json({ 
          error: "FACETEC_GROUP_NAME_FOR_KYC environment variable not set." 
        });
      }
      if (!process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS) {
        return res.status(500).json({ 
          error: "FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS environment variable not set." 
        });
      }
      groupNames.push(process.env.FACETEC_GROUP_NAME_FOR_KYC);
      groupNames.push(process.env.FACETEC_GROUP_NAME_FOR_SYBILS_ALLOWED_BIOMETRICS);
    }

    // Search for all identifiers in each group
    const allIdentifiers: string[] = [];
    
    for (const groupName of groupNames) {
      try {
        const searchResponse = await axios.post(
          `${getFaceTecBaseURL(req)}/3d-db/search`,
          {
            externalDatabaseRefID: externalDatabaseRefID,
            minMatchLevel: 15,
            groupName: groupName,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Device-Key": req.headers["x-device-key"],
              "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
              "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
            },
          }
        );

        if (searchResponse.data?.results && Array.isArray(searchResponse.data.results)) {
          const identifiers = searchResponse.data.results.map(
            (result: any) => result.identifier
          ).filter((id: any) => id != null);
          allIdentifiers.push(...identifiers);
        }
      } catch (err: any) {
        endpointLogger.error(
          { error: err, groupName },
          "Error during /3d-db/search"
        );
        // Continue with other groups even if one fails
      }
    }

    // Remove duplicates
    const uniqueIdentifiers = Array.from(new Set(allIdentifiers));

    if (uniqueIdentifiers.length === 0) {
      return res.status(404).json({ 
        error: "No matching entries found in FaceTec database." 
      });
    }

    // Delete each identifier from each group
    const deletePromises: Promise<any>[] = [];
    
    for (const identifier of uniqueIdentifiers) {
      for (const groupName of groupNames) {
        deletePromises.push(
          axios.post(
            `${getFaceTecBaseURL(req)}/3d-db/delete`,
            {
              identifier: identifier,
              groupName: groupName,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "X-Device-Key": req.headers["x-device-key"],
                "X-User-Agent": req.headers["x-user-agent"] || "human-id-server",
                "X-Api-Key": process.env.FACETEC_SERVER_API_KEY,
              },
            }
          ).catch((err: any) => {
            endpointLogger.error(
              { error: err, identifier, groupName },
              "Error during /3d-db/delete"
            );
            // Return error info but don't throw - we want to continue with other deletions
            return { error: true, identifier, groupName, err };
          })
        );
      }
    }

    const deleteResults = await Promise.all(deletePromises);
    
    // Check if any deletions failed
    const failures = deleteResults.filter((result: any) => result?.error);
    if (failures.length > 0) {
      endpointLogger.warn(
        { failures },
        "Some deletions failed"
      );
      // Still return success if at least some deletions succeeded
    }

    // Return success message based on selector
    let message: string;
    if (selector === "primary") {
      message = "Biometrics externalDatabaseRefID deleted successfully from primary collection.";
    } else if (selector === "secondary") {
      message = "Biometrics externalDatabaseRefID deleted successfully from secondary collection.";
    } else {
      message = "Biometrics externalDatabaseRefID deleted successfully from all collections.";
    }

    endpointLogger.info(
      { 
        sessionId: id, 
        selector, 
        identifiersDeleted: uniqueIdentifiers,
      },
      "Biometrics externalDatabaseRefID deleted successfully"
    );

    return res.status(200).json({ 
      message,
      identifiersDeleted: uniqueIdentifiers,
    });
  } catch (err: any) {
    endpointLogger.error({ error: err }, "An error occurred");
    return res.status(500).json({ error: "An unknown error occurred" });
  }
}
