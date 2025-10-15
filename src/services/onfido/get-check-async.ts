import axios from "axios";
import { IDVSessions, Session } from "../../init.js";
import { pinoOptions, logger } from "../../utils/logger.js";

const checkAsyncLogger = logger.child({
  msgPrefix: "[Onfido Check Async] ",
  base: {
    ...pinoOptions.base,
    service: "onfido-check-async",
  },
});

/**
 * Check if we should call the Onfido API based on the new logic
 */
function shouldCallCheckAPI(
  session: any,
  checkCreatedAt: Date
): boolean {
  // If check is withdrawn or paused, don't call API
  if (session?.check_status === "withdrawn" || session?.check_status === "paused") {
    return false;
  }
  
  // If status is complete but missing result, call API
  if (session?.check_status === "complete" && !session?.check_result) {
    checkAsyncLogger.info(
      { check_id: session.check_id, status: session.check_status, hasResult: !!session?.check_result, hasReportIds: !!session?.check_report_ids },
      "Status is complete but missing result or report_ids, calling API"
    );
    return true;
  }
  
  // If no check_status field exists (ongoing check from old schema), always call API
  if (!session?.check_status) {
    checkAsyncLogger.info(
      { check_id: session.check_id },
      "No check_status field found (ongoing check from old schema), calling API"
    );
    return true;
  }
  
  // If status is not complete
  // get the more recent of createdAt vs last_updated_at
  // and check if it's older than 30 seconds
  if (session?.check_status !== "complete") {
    const now = new Date();
    
    // Determine the most recent timestamp between createdAt and last_updated_at
    let mostRecentTime = checkCreatedAt;
    
    if (session?.check_last_updated_at) {
      const lastUpdatedAt = new Date(session.check_last_updated_at);
      if (lastUpdatedAt > checkCreatedAt) {
        mostRecentTime = lastUpdatedAt;
      }
    }
    
    const checkAgeSeconds = (now.getTime() - mostRecentTime.getTime()) / 1000;
    
    if (checkAgeSeconds > 30) {
      return true;
    }
  }
  
  // If we have complete data with result, don't call API
  if (session?.check_status === "complete" && session?.check_result) {
    checkAsyncLogger.info(
      { check_id: session.check_id, status: session.check_status },
      "Check is complete with all data, no API call needed"
    );
    return false;
  }
  
  return false;
}

/**
 * getOnfidoCheckAsync - checks database first, then calls API when needed
 * 
 * Logic:
 * 1. If status is complete but missing result or report_ids -> call API
 * 2. If status is not complete and check is older than 2 minutes -> call API
 * 3. Otherwise return cached data
 */
export async function getOnfidoCheckAsync(check_id: string): Promise<any> {
  try {
    // First, try to get check data from Session collection
    const session = await Session.findOne({
      check_id: check_id,
    }).exec();

    if (!session) {
      checkAsyncLogger.warn({ check_id }, "No session found for check_id, falling back to API");
      return await callOnfidoCheckAPI(check_id);
    }

    // Extract creation time from ObjectId (first 4 bytes contain timestamp)
    const createdAt = new Date(parseInt(session._id.toString().substring(0, 8), 16) * 1000);

    // Check if we need to call the check API
    const shouldCall = shouldCallCheckAPI(session, createdAt);
    
    if (!shouldCall) {
      checkAsyncLogger.info({ check_id, shouldCall }, "Onfido check data from cache");

      // Return cached data if we don't need to call API yet
      return {
        id: check_id,
        status: session.check_status || "in_progress",
        result: session.check_result,
        report_ids: session.check_report_ids || [],
      };
    }

    // Call Onfido API to get result and report_ids
    checkAsyncLogger.info({ check_id, reason: "missing_data_or_old_check" }, "Calling Onfido check API to get complete check data");
    const apiResult = await callOnfidoCheckAPI(check_id);
    
    if (apiResult) {
      // Update our database with the fresh data
      await updateCheckInDB(session, check_id, apiResult);
    }
    
    return apiResult;
    
  } catch (err) {
    checkAsyncLogger.error(
      { error: err, check_id },
      "Error in smart check, falling back to API"
    );
    return await callOnfidoCheckAPI(check_id);
  }
}

/**
 * Call Onfido API directly
 */
async function callOnfidoCheckAPI(check_id: string): Promise<any> {
  try {
    // @ts-ignore
    const resp = await axios.get(`https://api.us.onfido.com/v3.6/checks/${check_id}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${process.env.ONFIDO_API_TOKEN}`,
      },
    });
    return resp.data;
  } catch (err: any) {
    let errToLog = err;
    // Onfido deletes checks after 30 days. So, if we get a 410, clear the check data
    // from Session.
    // if (err.response?.status === 410) {
    //   errToLog = err.message; // reduces unnecessary verbosity
    //   await Session.findOneAndUpdate(
    //     { check_id: check_id },
    //     {
    //       $unset: {
    //         check_id: 1,
    //         check_status: 1,
    //         "onfido.result": 1,
    //         "onfido.report_ids": 1,
    //       },
    //     }
    //   ).exec();
    // }
    checkAsyncLogger.error(
      { error: errToLog, check_id },
      "An error occurred while polling Onfido API"
    );
    return null;
  }
}

/**
 * Update check data in database
 */
async function updateCheckInDB(session: any, check_id: string, apiResult: any) {
  try {
    // Update session fields
    session.check_status = apiResult.status;
    session.check_result = apiResult.result;
    session.check_report_ids = apiResult.report_ids || [];
    session.check_last_updated_at = new Date();

    await session.save();
        
    checkAsyncLogger.info(
      { check_id, status: apiResult.status },
      "Updated check data in database from API"
    );
  } catch (err) {
    checkAsyncLogger.error(
      { error: err, check_id },
      "Error updating check in database"
    );
  }
}
