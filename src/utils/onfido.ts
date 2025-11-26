import axios from "axios";
import logger from "./logger.js"
import { desiredOnfidoReports } from "../constants/onfido.js";

export async function createOnfidoApplicant(onfidoAPIKey: string) {
  try {
    const reqBody = {
      // From Onfido docs:
      // "For Document reports, first_name and last_name must be provided but can be
      // dummy values if you don't know an applicant's name."
      first_name: "Alice",
      last_name: "Smith",
      // NOTE: `location` is required for facial similarity reports.
      // NOTE: `consent` is required for US applicants. From Onfido docs: "If the location of
      // the applicant is the US, you must also provide consent information confirming that
      // the end user has viewed and accepted Onfido’s privacy notices and terms of service."
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${onfidoAPIKey}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/applicants",
      reqBody,
      config
    );
    return resp.data;
  } catch (err: any) {
    console.error("Error creating Onfido applicant", err.message, err.response?.data);
  }
}

export async function createOnfidoSdkToken(onfidoAPIKey: string, applicant_id: string, referrer?: string) {
  try {
    if (!referrer) {
      referrer =
        process.env.NODE_ENV === "development"
          ? "http://localhost:3002/*"
          : "https://app.holonym.id/*";
    }
    // Create an SDK token for the applicant
    const body = `applicant_id=${applicant_id}&referrer=${referrer}`;
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Token token=${onfidoAPIKey}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/sdk_token",
      body,
      config
    );
    return resp.data;
  } catch (err: any) {
    logger.error(
      {
        errMsg: err.message,
        errResponseData: err.response?.data
      },
      "Error creating Onfido SDK token"
    )
  }
}

export async function createOnfidoCheck(onfidoAPIKey: string, applicant_id: string) {
  try {
    const reqBody = {
      applicant_id,
      report_names: desiredOnfidoReports,
      // applicant_provides_data: true,
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${onfidoAPIKey}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/checks",
      reqBody,
      config
    );
    return resp.data;
  } catch (err: any) {
    console.error("Error creating Onfido check",
      err.message,
      JSON.stringify(err.response?.data ?? {}, null, 2)
    );
    const details = err.response?.data?.error?.message ?? ''
    throw new Error("Error creating Onfido check" + ". " + details);
  }
}

export async function createOnfidoWorkflowRun(onfidoAPIKey: string, applicant_id: string, workflow_id: string) {
  try {
    // Create a workflow run for the applicant
    const reqBody = {
      applicant_id,
      workflow_id,
    };
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${onfidoAPIKey}`,
      },
    };
    const resp = await axios.post(
      "https://api.us.onfido.com/v3.6/workflow_runs",
      reqBody,
      config
    );
    return resp.data;
  } catch (err: any) {
    console.error("Error creating Onfido workflow run", err.message, err.response?.data);
  }
}

export async function getOnfidoCheck(onfidoAPIKey: string, check_id: string) {
  try {
    const resp = await axios.get(`https://api.us.onfido.com/v3.6/checks/${check_id}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token token=${onfidoAPIKey}`,
      },
    });
    return resp.data;
  } catch (err: any) {
    console.error(
      `Error getting check with ID ${check_id}`,
      err.message,
      err.response?.data
    );
  }
}

export async function getOnfidoReports(onfidoAPIKey: string, report_ids: Array<string>) {
  try {
    const reports = [];
    for (const report_id of report_ids) {
      const resp = await axios.get(
        `https://api.us.onfido.com/v3.6/reports/${report_id}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token token=${onfidoAPIKey}`,
          },
        }
      );
      reports.push(resp.data);
    }
    return reports;
  } catch (err: any) {
    console.error(
      `Error getting reports. report_ids: ${report_ids}`,
      err.message,
      err.response?.data
    );
  }
}

export async function deleteOnfidoApplicant(onfidoAPIKey: string, applicant_id: string) {
  try {
    // ignoring "Property 'delete' does not exist on type 'typeof import(...)'"
    // @ts-ignore
    return await axios.delete(
      `https://api.us.onfido.com/v3.6/applicants/${applicant_id}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token token=${onfidoAPIKey}`,
        },
      }
    );
  } catch (err: any) {
    console.log(
      `Error deleting Onfido applicant with applicant_id ${applicant_id}`,
      err.message,
      err.response?.data
    );
  }
}
