import { Request } from "express";

import {
  facetecServerBaseURL,
  facetecServer2BaseURL
} from "@/constants/misc.js";

export function getFaceTecBaseURL(req: Request) {
  const host = req.headers["x-frontend-origin"] as string | undefined;
  if (host?.includes("id.human.tech")) {
    return facetecServer2BaseURL;
  }
  return facetecServerBaseURL;
}
