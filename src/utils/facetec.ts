import { Request } from "express";

import {
  facetecServerBaseURL,
  facetecServer2BaseURL
} from "../constants/misc.js";

export function getFaceTecBaseURL(req: Request) {
  return facetecServer2BaseURL
  // Since FaceTec released their v10 SDK, we are no longer supporting our v1 custom FaceTec server
  // const host = req.headers["x-frontend-origin"] as string | undefined;
  // if (host?.includes("id.human.tech")) {
  //   return facetecServer2BaseURL;
  // }
  // return facetecServerBaseURL;
}
