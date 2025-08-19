export const ADMIN_EMAILS = process.env.ADMIN_EMAILS?.split(",");

// newDummyUserCreds does not include the following fields, though they should be
// returned in the final response: issuer, secret, signature, or serializedCreds.
export const newDummyUserCreds = {
  rawCreds: {
    birthdate: "1950-01-01",
    city: "New York",
    completedAt: "2022-09-16", // "2022-09-16T02:21:59.510Z",
    countryCode: 2,
    firstName: "Satoshi",
    middleName: "Bitcoin",
    lastName: "Nakamoto",
    streetName: "Main St",
    streetNumber: 123,
    streetUnit: 0,
    subdivision: "NY",
    zipCode: 12345,
    expirationDate: "2023-09-16",
  },
  derivedCreds: {
    nameDobCitySubdivisionZipStreetExpireHash: {
      value:
        "9717857759462285186569434641069066147758238358576257073710143504773145901957",
      derivationFunction: "poseidon",
      inputFields: [
        "derivedCreds.nameHash.value",
        "rawCreds.birthdate",
        "derivedCreds.addressHash.value",
        "rawCreds.expirationDate",
      ],
    },
    streetHash: {
      value:
        "17873212585024051139139509857141244009065298068743399015831877928660937058344",
      derivationFunction: "poseidon",
      inputFields: [
        "rawCreds.streetNumber",
        "rawCreds.streetName",
        "rawCreds.streetUnit",
      ],
    },
    addressHash: {
      value:
        "17213269051117435556051219503291950994606806381770319609350243626357241456114",
      derivationFunction: "poseidon",
      inputFields: [
        "rawCreds.city",
        "rawCreds.subdivision",
        "rawCreds.zipCode",
        "derivedCreds.streetHash.value",
      ],
    },
    nameHash: {
      value:
        "19262609406206667575009933537774132284595466745295665914649892492870480170698",
      derivationFunction: "poseidon",
      inputFields: ["rawCreds.firstName", "rawCreds.middleName", "rawCreds.lastName"],
    },
  },
  fieldsInLeaf: [
    "issuer",
    "secret",
    "rawCreds.countryCode",
    "derivedCreds.nameDobCitySubdivisionZipStreetExpireHash.value",
    "rawCreds.completedAt",
    "scope",
  ],
};

export const cleanHandsDummyUserCreds = {
  rawCreds: {
    birthdate: "1950-01-01",
    firstName: "Satoshi",
    lastName: "Nakamoto"
  },
  derivedCreds: {
    nameHash: {
      value: "16915550794603762685249398654174029170499664310588415409737148304879240042377",
      derivationFunction: "poseidon",
      inputFields: [
        "rawCreds.firstName",
        "rawCreds.lastName",
      ],
    },
  },
  fieldsInLeaf: [
    "issuer",
    "secret",
    "rawCreds.birthdate",
    "derivedCreds.nameHash",
    "iat", // TODO: Is this correct?
    "scope",
  ],
};

export const campaignIdToWorkflowIdMap: Record<string, string> = {
  "test": "19d0c530-8b15-4893-9067-03c0685e2624",
  "ika": "0ce09160-ef72-4726-ab13-56244adcc266",
}

export const campaignIdToActionIdMap = {
  "test": "001",
  "ika": "007",
}

export const stateAbbreviations = {
  ALABAMA: "AL",
  ALASKA: "AK",
  "AMERICAN SAMOA": "AS",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  "FEDERATED STATES OF MICRONESIA": "FM",
  FLORIDA: "FL",
  GEORGIA: "GA",
  GUAM: "GU",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  "MARSHALL ISLANDS": "MH",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  "NORTHERN MARIANA ISLANDS": "MP",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PALAU: "PW",
  PENNSYLVANIA: "PA",
  "PUERTO RICO": "PR",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  "VIRGIN ISLANDS": "VI",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
};

const primes = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79,
  83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167,
  173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263,
  269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359, 367,
  373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433, 439, 443, 449, 457, 461, 463,
  467, 479, 487, 491, 499, 503, 509, 521, 523, 541, 547, 557, 563, 569, 571, 577, 587,
  593, 599, 601, 607, 613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683,
  691, 701, 709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809, 811,
  821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919, 929,
  937, 941, 947, 953, 967, 971, 977, 983, 991, 997, 1009, 1013, 1019, 1021, 1031, 1033,
  1039, 1049, 1051, 1061, 1063, 1069, 1087, 1091, 1093, 1097, 1103, 1109, 1117, 1123,
  1129, 1151, 1153, 1163, 1171, 1181,
]; // 1187,

export const countryCodeToPrime = {
  US: 2, // United States (ISO 3166-1 alpha-2)
  USA: 2, // United States (ISO 3166-1 alpha-3)
  AL: 3, // Albania (ISO 3166-1 alpha-2)
  ALB: 3, // Albania (ISO 3166-1 alpha-3)
  DZ: 5, // Algeria (ISO 3166-1 alpha-2)
  DZA: 5, // Algeria (ISO 3166-1 alpha-3)
  AD: 7, // Andorra (ISO 3166-1 alpha-2)
  AND: 7, // Andorra (ISO 3166-1 alpha-3)
  AO: 11, // Angola (ISO 3166-1 alpha-2)
  AG: 13, // Antigua and Barbuda (ISO 3166-1 alpha-2)
  ATG: 13, // Antigua and Barbuda (ISO 3166-1 alpha-3)
  AR: 17, // Argentina (ISO 3166-1 alpha-2)
  ARG: 17, // Argentina (ISO 3166-1 alpha-3)
  AM: 19, // Armenia (ISO 3166-1 alpha-2)
  ARM: 19, // Armenia (ISO 3166-1 alpha-3)
  AU: 23, // Australia (ISO 3166-1 alpha-2)
  AUS: 23, // Australia (ISO 3166-1 alpha-3)
  AT: 29, // Austria (ISO 3166-1 alpha-2)
  AUT: 29, // Austria (ISO 3166-1 alpha-3)
  AZ: 31, // Azerbaijan (ISO 3166-1 alpha-2)
  AZE: 31, // Azerbaijan (ISO 3166-1 alpha-3)
  BS: 37, // Bahamas (ISO 3166-1 alpha-2)
  BHS: 37, // Bahamas (ISO 3166-1 alpha-3)
  BH: 41, // Bahrain (ISO 3166-1 alpha-2)
  BHR: 41, // Bahrain (ISO 3166-1 alpha-3)
  BD: 43, // Bangladesh (ISO 3166-1 alpha-2)
  BGD: 43, // Bangladesh (ISO 3166-1 alpha-3)
  BB: 47, // Barbados (ISO 3166-1 alpha-2)
  BRB: 47, // Barbados (ISO 3166-1 alpha-3)
  BY: 53, // Belarus (ISO 3166-1 alpha-2)
  BLR: 53, // Belarus (ISO 3166-1 alpha-3)
  BE: 59, // Belgium (ISO 3166-1 alpha-2)
  BEL: 59, // Belgium (ISO 3166-1 alpha-3)
  BZ: 61, // Belize (ISO 3166-1 alpha-2)
  BLZ: 61, // Belize (ISO 3166-1 alpha-3)
  BJ: 67, // Benin (ISO 3166-1 alpha-2)
  BEN: 67, // Benin (ISO 3166-1 alpha-3)
  BT: 71, // Bhutan (ISO 3166-1 alpha-2)
  BTN: 71, // Bhutan (ISO 3166-1 alpha-3)
  BO: 73, // "Bolivia, Plurinational State of" (ISO 3166-1 alpha-2)
  BOL: 73, // "Bolivia, Plurinational State of" (ISO 3166-1 alpha-3)
  BA: 79, // Bosnia and Herzegovina (ISO 3166-1 alpha-2)
  BIH: 79, // Bosnia and Herzegovina (ISO 3166-1 alpha-3)
  BW: 83, // Botswana (ISO 3166-1 alpha-2)
  BWA: 83, // Botswana (ISO 3166-1 alpha-3)
  BR: 89, // Brazil (ISO 3166-1 alpha-2)
  BRA: 89, // Brazil (ISO 3166-1 alpha-3)
  BN: 97, // Brunei Darussalam (ISO 3166-1 alpha-2)
  BRN: 97, // Brunei Darussalam (ISO 3166-1 alpha-3)
  BG: 101, // Bulgaria (ISO 3166-1 alpha-2)
  BGR: 101, // Bulgaria (ISO 3166-1 alpha-3)
  BF: 103, // Burkina Faso (ISO 3166-1 alpha-2)
  BFA: 103, // Burkina Faso (ISO 3166-1 alpha-3)
  BI: 107, // Burundi (ISO 3166-1 alpha-2)
  BDI: 107, // Burundi (ISO 3166-1 alpha-3)
  KH: 109, // Cambodia (ISO 3166-1 alpha-2)
  KHM: 109, // Cambodia (ISO 3166-1 alpha-3)
  CM: 113, // Cameroon (ISO 3166-1 alpha-2)
  CMR: 113, // Cameroon (ISO 3166-1 alpha-3)
  CA: 127, // Canada (ISO 3166-1 alpha-2)
  CAN: 127, // Canada (ISO 3166-1 alpha-3)
  CV: 131, // Cape Verde (ISO 3166-1 alpha-2)
  CF: 137, // Central African Republic (ISO 3166-1 alpha-2)
  CAF: 137, // Central African Republic (ISO 3166-1 alpha-3)
  TD: 139, // Chad (ISO 3166-1 alpha-2)
  TCD: 139, // Chad (ISO 3166-1 alpha-3)
  CL: 149, // Chile (ISO 3166-1 alpha-2)
  CHL: 149, // Chile (ISO 3166-1 alpha-3)
  CN: 151, // China (ISO 3166-1 alpha-2)
  CHN: 151, // China (ISO 3166-1 alpha-3)
  CO: 157, // Colombia (ISO 3166-1 alpha-2)
  COL: 157, // Colombia (ISO 3166-1 alpha-3)
  KM: 163, // Comoros (ISO 3166-1 alpha-2)
  COM: 163, // Comoros (ISO 3166-1 alpha-3)
  CG: 167, // Congo (ISO 3166-1 alpha-2)
  COG: 167, // Congo (ISO 3166-1 alpha-3)
  CD: 173, // "Congo, the Democratic Republic of the", (ISO 3166-1 alpha-2)
  COD: 173, // "Congo, the Democratic Republic of the", (ISO 3166-1 alpha-3)
  CR: 179, // Costa Rica (ISO 3166-1 alpha-2)
  CRI: 179, // Costa Rica (ISO 3166-1 alpha-3)
  CI: 181, // Côte d'Ivoire (ISO 3166-1 alpha-2)
  CIV: 181, // Côte d'Ivoire (ISO 3166-1 alpha-3)
  HR: 191, // Croatia (ISO 3166-1 alpha-2)
  HRV: 191, // Croatia (ISO 3166-1 alpha-3)
  // We do not service Cuba
  // CU: 193, // Cuba (ISO 3166-1 alpha-2)
  // CUB: 193, // Cuba (ISO 3166-1 alpha-3)
  CY: 197, // Cyprus (ISO 3166-1 alpha-2)
  CYP: 197, // Cyprus (ISO 3166-1 alpha-3)
  CZ: 199, // Czech Republic (ISO 3166-1 alpha-2)
  CZE: 199, // Czech Republic (ISO 3166-1 alpha-3)
  DK: 211, // Denmark (ISO 3166-1 alpha-2)
  DNK: 211, // Denmark (ISO 3166-1 alpha-3)
  DJ: 223, // Djibouti (ISO 3166-1 alpha-2)
  DJI: 233, // Djibouti (ISO 3166-1 alpha-3)
  DM: 227, // Dominica (ISO 3166-1 alpha-2)
  DMA: 227, // Dominica (ISO 3166-1 alpha-3)
  DO: 229, // Dominican Republic (ISO 3166-1 alpha-2)
  DOM: 229, // Dominican Republic (ISO 3166-1 alpha-3)
  EC: 233, // Ecuador (ISO 3166-1 alpha-2)
  ECU: 233, // Ecuador (ISO 3166-1 alpha-3)
  EG: 239, // Egypt (ISO 3166-1 alpha-2)
  EGY: 239, // Egypt (ISO 3166-1 alpha-3)
  SV: 241, // El Salvador (ISO 3166-1 alpha-2)
  SLV: 241, // El Salvador (ISO 3166-1 alpha-3)
  GQ: 251, // Equatorial Guinea (ISO 3166-1 alpha-2)
  GNQ: 251, // Equatorial Guinea (ISO 3166-1 alpha-3)
  ER: 257, // Eritrea (ISO 3166-1 alpha-2)
  ERI: 257, // Eritrea (ISO 3166-1 alpha-3)
  EE: 263, // Estonia (ISO 3166-1 alpha-2)
  EST: 263, // Estonia (ISO 3166-1 alpha-3)
  SZ: 269, // Eswatini, Kingdom of // (formerly Swaziland) (ISO 3166-1 alpha-2)
  SWZ: 269, // Eswatini, Kingdom of // (formerly Swaziland) (ISO 3166-1 alpha-3)
  ET: 271, // Ethiopia (ISO 3166-1 alpha-2)
  ETH: 271, // Ethiopia (ISO 3166-1 alpha-3)
  FJ: 277, // Fiji (ISO 3166-1 alpha-2)
  FJI: 277, // Fiji (ISO 3166-1 alpha-3)
  FI: 281, // Finland (ISO 3166-1 alpha-2)
  FIN: 281, // Finland (ISO 3166-1 alpha-3)
  FR: 283, // France (ISO 3166-1 alpha-2)
  FRA: 283, // France (ISO 3166-1 alpha-3)
  GA: 293, // Gabon (ISO 3166-1 alpha-2)
  GAB: 293, // Gabon (ISO 3166-1 alpha-3)
  GM: 307, // Gambia (ISO 3166-1 alpha-2)
  GMB: 307, // Gambia (ISO 3166-1 alpha-3)
  GE: 311, // Georgia (ISO 3166-1 alpha-2)
  GEO: 311, // Georgia (ISO 3166-1 alpha-3)
  DE: 313, // Germany (ISO 3166-1 alpha-2)
  DEU: 313, // Germany (ISO 3166-1 alpha-3)
  GH: 317, // Ghana (ISO 3166-1 alpha-2)
  GHA: 317, // Ghana (ISO 3166-1 alpha-3)
  GR: 331, // Greece (ISO 3166-1 alpha-2)
  GRC: 331, // Greece (ISO 3166-1 alpha-3)
  GD: 337, // Grenada (ISO 3166-1 alpha-2)
  GRD: 337, // Grenada (ISO 3166-1 alpha-3)
  GT: 347, // Guatemala (ISO 3166-1 alpha-2)
  GTM: 347, // Guatemala (ISO 3166-1 alpha-3)
  GN: 349, // Guinea (ISO 3166-1 alpha-2)
  GIN: 349, // Guinea (ISO 3166-1 alpha-3)
  GW: 353, // Guinea-Bissau (ISO 3166-1 alpha-2)
  GNB: 353, // Guinea-Bissau (ISO 3166-1 alpha-3)
  GY: 359, // Guyana (ISO 3166-1 alpha-2)
  GUY: 359, // Guyana (ISO 3166-1 alpha-3)
  HT: 367, // Haiti (ISO 3166-1 alpha-2)
  HTI: 367, // Haiti (ISO 3166-1 alpha-3)
  HN: 373, // Honduras (ISO 3166-1 alpha-2)
  HND: 373, // Honduras (ISO 3166-1 alpha-3)
  HU: 379, // Hungary (ISO 3166-1 alpha-2)
  HUN: 379, // Hungary (ISO 3166-1 alpha-3)
  IS: 383, // Iceland (ISO 3166-1 alpha-2)
  ISL: 383, // Iceland (ISO 3166-1 alpha-3)
  IN: 389, // India (ISO 3166-1 alpha-2)
  IND: 389, // India (ISO 3166-1 alpha-3)
  ID: 397, // Indonesia (ISO 3166-1 alpha-2)
  IDN: 397, // Indonesia (ISO 3166-1 alpha-3)
  // We do not service Iran
  // IR: 401, // "Iran, Islamic Republic of" (ISO 3166-1 alpha-2)
  // IRN: 401, // Iran (Islamic Republic of) (ISO 3166-1 alpha-3)
  IQ: 409, // Iraq (ISO 3166-1 alpha-2)
  IRQ: 409, // Iraq (ISO 3166-1 alpha-3)
  IE: 419, // Ireland (ISO 3166-1 alpha-2)
  IRL: 419, // Ireland (ISO 3166-1 alpha-3)
  IL: 421, // Israel (ISO 3166-1 alpha-2)
  ISR: 421, // Israel (ISO 3166-1 alpha-3)
  IT: 431, // Italy (ISO 3166-1 alpha-2)
  ITA: 431, // Italy (ISO 3166-1 alpha-3)
  JM: 433, // Jamaica (ISO 3166-1 alpha-2)
  JAM: 433, // Jamaica (ISO 3166-1 alpha-3)
  JP: 439, // Japan (ISO 3166-1 alpha-2)
  JPN: 439, // Japan (ISO 3166-1 alpha-3)
  JO: 443, // Jordan (ISO 3166-1 alpha-2)
  JOR: 443, // Jordan (ISO 3166-1 alpha-3)
  KZ: 449, // Kazakhstan (ISO 3166-1 alpha-2)
  KAZ: 449, // Kazakhstan (ISO 3166-1 alpha-3)
  KE: 457, // Kenya (ISO 3166-1 alpha-2)
  KEN: 457, // Kenya (ISO 3166-1 alpha-3)
  KI: 461, // Kiribati (ISO 3166-1 alpha-2)
  KIR: 461, // Kiribati (ISO 3166-1 alpha-3)
  // We do not service North Korea
  // KP: 463, // "Korea, Democratic People's Republic of" (ISO 3166-1 alpha-2)
  KR: 467, // "Korea, Republic of" (ISO 3166-1 alpha-2)
  KOR: 467, // Korea (Republic of) (ISO 3166-1 alpha-3)
  KW: 479, // Kuwait (ISO 3166-1 alpha-2)
  KWT: 479, // Kuwait (ISO 3166-1 alpha-3)
  KG: 487, // Kyrgyzstan (ISO 3166-1 alpha-2)
  KGZ: 487, // Kyrgyzstan (ISO 3166-1 alpha-3)
  LA: 491, // Lao People's Democratic Republic (ISO 3166-1 alpha-2)
  LAO: 491, // Lao People's Democratic Republic (ISO 3166-1 alpha-3)
  LV: 499, // Latvia (ISO 3166-1 alpha-2)
  LVA: 499, // Latvia (ISO 3166-1 alpha-3)
  LB: 503, // Lebanon (ISO 3166-1 alpha-2)
  LBN: 503, // Lebanon (ISO 3166-1 alpha-3)
  LS: 509, // Lesotho (ISO 3166-1 alpha-2)
  LSO: 509, // Lesotho (ISO 3166-1 alpha-3)
  LR: 521, // Liberia (ISO 3166-1 alpha-2)
  LY: 523, // Libya // (formerly Libyan Arab Jamahiriya) (ISO 3166-1 alpha-2)
  LBY: 523, // Libya (ISO 3166-1 alpha-3)
  LI: 541, // Liechtenstein (ISO 3166-1 alpha-2)
  LIE: 541, // Liechtenstein (ISO 3166-1 alpha-3)
  LT: 547, // Lithuania (ISO 3166-1 alpha-2)
  LTU: 547, // Lithuania (ISO 3166-1 alpha-3)
  LU: 557, // Luxembourg (ISO 3166-1 alpha-2)
  LUX: 557, // Luxembourg (ISO 3166-1 alpha-3)
  MK: 563, // North Macedonia // (formerly "Macedonia, the former Yugoslav Republic of") (ISO 3166-1 alpha-2)
  MKD: 563, // North Macedonia // (formerly "Macedonia, the former Yugoslav Republic of") (ISO 3166-1 alpha-3)
  MG: 569, // Madagascar (ISO 3166-1 alpha-2)
  MDG: 569, // Madagascar (ISO 3166-1 alpha-3)
  MW: 571, // Malawi (ISO 3166-1 alpha-2)
  MWI: 571, // Malawi (ISO 3166-1 alpha-3)
  MY: 577, // Malaysia (ISO 3166-1 alpha-2)
  MYS: 577, // Malaysia (ISO 3166-1 alpha-3)
  MV: 587, // Maldives (ISO 3166-1 alpha-2)
  MDV: 587, // Maldives (ISO 3166-1 alpha-3)
  ML: 593, // Mali (ISO 3166-1 alpha-2)
  MLI: 593, // Mali (ISO 3166-1 alpha-3)
  MT: 599, // Malta (ISO 3166-1 alpha-2)
  MLT: 599, // Malta (ISO 3166-1 alpha-3)
  MH: 601, // Marshall Islands (ISO 3166-1 alpha-2)
  MHL: 601, // Marshall Islands (ISO 3166-1 alpha-3)
  MR: 607, // Mauritania (ISO 3166-1 alpha-2)
  MRT: 607, // Mauritania (ISO 3166-1 alpha-3)
  MU: 613, // Mauritius (ISO 3166-1 alpha-2)
  MUS: 613, // Mauritius (ISO 3166-1 alpha-3)
  MX: 617, // Mexico (ISO 3166-1 alpha-2)
  MEX: 617, // Mexico (ISO 3166-1 alpha-3)
  FM: 619, // "Micronesia, Federated States of" (ISO 3166-1 alpha-2)
  FSM: 619, // "Micronesia, Federated States of" (ISO 3166-1 alpha-3)
  MD: 631, // "Moldova, Republic of", (ISO 3166-1 alpha-2)
  MDA: 631, // "Moldova, Republic of" (ISO 3166-1 alpha-3)
  MC: 641, // Monaco (ISO 3166-1 alpha-2)
  MCO: 641, // Monaco (ISO 3166-1 alpha-3)
  MN: 643, // Mongolia (ISO 3166-1 alpha-2)
  MNG: 643, // Mongolia (ISO 3166-1 alpha-3)
  ME: 647, // Montenegro (ISO 3166-1 alpha-2)
  MNE: 647, // Montenegro (ISO 3166-1 alpha-3)
  MA: 653, // Morocco (ISO 3166-1 alpha-2)
  MAR: 653, // Morocco (ISO 3166-1 alpha-3)
  MZ: 659, // Mozambique (ISO 3166-1 alpha-2)
  MOZ: 659, // Mozambique (ISO 3166-1 alpha-3)
  MM: 661, // Myanmar (ISO 3166-1 alpha-2)
  MMR: 661, // Myanmar (ISO 3166-1 alpha-3)
  NA: 673, // Namibia (ISO 3166-1 alpha-2)
  NAM: 673, // Namibia (ISO 3166-1 alpha-3)
  NR: 677, // Nauru (ISO 3166-1 alpha-2)
  NRU: 677, // Nauru (ISO 3166-1 alpha-3)
  NP: 683, // Nepal (ISO 3166-1 alpha-2)
  NPL: 683, // Nepal (ISO 3166-1 alpha-3)
  NL: 691, // Netherlands (ISO 3166-1 alpha-2)
  NLD: 691, // Netherlands (ISO 3166-1 alpha-3)
  NZ: 701, // New Zealand (ISO 3166-1 alpha-2)
  NZL: 701, // New Zealand (ISO 3166-1 alpha-3)
  NI: 709, // Nicaragua (ISO 3166-1 alpha-2)
  NIC: 709, // Nicaragua (ISO 3166-1 alpha-3)
  NE: 719, // Niger (ISO 3166-1 alpha-2)
  NER: 719, // Niger (ISO 3166-1 alpha-3)
  NG: 727, // Nigeria (ISO 3166-1 alpha-2)
  NGA: 727, // Nigeria (ISO 3166-1 alpha-3)
  NO: 733, // Norway (ISO 3166-1 alpha-2)
  NOR: 733, // Norway (ISO 3166-1 alpha-3)
  OM: 739, // Oman (ISO 3166-1 alpha-2)
  OMN: 739, // Oman (ISO 3166-1 alpha-3)
  PK: 743, // Pakistan (ISO 3166-1 alpha-2)
  PAK: 743, // Pakistan (ISO 3166-1 alpha-3)
  PW: 751, // Palau (ISO 3166-1 alpha-2)
  PLW: 751, // Palau (ISO 3166-1 alpha-3)
  PA: 757, // Panama (ISO 3166-1 alpha-2)
  PAN: 757, // Panama (ISO 3166-1 alpha-3)
  PG: 761, // Papua New Guinea (ISO 3166-1 alpha-2)
  PY: 769, // Paraguay (ISO 3166-1 alpha-2)
  PRY: 769, // Paraguay (ISO 3166-1 alpha-3)
  PE: 773, // Peru (ISO 3166-1 alpha-2)
  PER: 773, // Peru (ISO 3166-1 alpha-3)
  PH: 787, // Philippines (ISO 3166-1 alpha-2)
  PHL: 787, // Philippines (ISO 3166-1 alpha-3)
  PL: 797, // Poland (ISO 3166-1 alpha-2)
  POL: 797, // Poland (ISO 3166-1 alpha-3)
  PT: 809, // Portugal (ISO 3166-1 alpha-2)
  PRT: 809, // Portugal (ISO 3166-1 alpha-3)
  // PR: 10000, // Puerto Rico (ISO 3166-1 alpha-2)
  // PRI: 10000, // Puerto Rico (ISO 3166-1 alpha-3)
  QA: 811, // Qatar (ISO 3166-1 alpha-2)
  QAT: 811, // Qatar (ISO 3166-1 alpha-3)
  RO: 821, // Romania (ISO 3166-1 alpha-2)
  ROU: 821, // Romania (ISO 3166-1 alpha-3)
  RU: 823, // Russian Federation (ISO 3166-1 alpha-2)
  RUS: 823, // Russian Federation (ISO 3166-1 alpha-3)
  RW: 827, // Rwanda (ISO 3166-1 alpha-2)
  KN: 829, // Saint Kitts and Nevis (ISO 3166-1 alpha-2)
  KNA: 829, // Saint Kitts and Nevis (ISO 3166-1 alpha-3)
  LC: 839, // Saint Lucia (ISO 3166-1 alpha-2)
  LCA: 839, // Saint Lucia (ISO 3166-1 alpha-3)
  VC: 853, // Saint Vincent and the Grenadines (ISO 3166-1 alpha-2)
  VCT: 853, // Saint Vincent and the Grenadines (ISO 3166-1 alpha-3)
  WS: 857, // Samoa (ISO 3166-1 alpha-2)
  WSM: 857, // Samoa (ISO 3166-1 alpha-3)
  SM: 859, // San Marino (ISO 3166-1 alpha-2)
  SMR: 859, // San Marino (ISO 3166-1 alpha-3)
  ST: 863, // Sao Tome and Principe (ISO 3166-1 alpha-2)
  STP: 863, // Sao Tome and Principe (ISO 3166-1 alpha-3)
  SA: 877, // Saudi Arabia (ISO 3166-1 alpha-2)
  SAU: 877, // Saudi Arabia (ISO 3166-1 alpha-3)
  SN: 881, // Senegal (ISO 3166-1 alpha-2)
  SEN: 881, // Senegal (ISO 3166-1 alpha-3)
  RS: 883, // Serbia (ISO 3166-1 alpha-2)
  SRB: 883, // Serbia (ISO 3166-1 alpha-3)
  SC: 887, // Seychelles (ISO 3166-1 alpha-2)
  SYC: 887, // Seychelles (ISO 3166-1 alpha-3)
  SL: 907, // Sierra Leone (ISO 3166-1 alpha-2)
  SLE: 907, // Sierra Leone (ISO 3166-1 alpha-3)
  SG: 911, // Singapore (ISO 3166-1 alpha-2)
  SGP: 911, // Singapore (ISO 3166-1 alpha-3)
  SK: 919, // Slovakia (ISO 3166-1 alpha-2)
  SVK: 919, // Slovakia (ISO 3166-1 alpha-3)
  SI: 929, // Slovenia (ISO 3166-1 alpha-2)
  SVN: 929, // Slovenia (ISO 3166-1 alpha-3)
  SB: 937, // Solomon Islands (ISO 3166-1 alpha-2)
  SLB: 937, // Solomon Islands (ISO 3166-1 alpha-3)
  SO: 941, // Somalia (ISO 3166-1 alpha-2)
  SOM: 941, // Somalia (ISO 3166-1 alpha-3)
  ZA: 947, // South Africa (ISO 3166-1 alpha-2)
  ZAF: 947, // South Africa (ISO 3166-1 alpha-3)
  // TODO: South Sudan?
  ES: 953, // Spain (ISO 3166-1 alpha-2)
  ESP: 953, // Spain (ISO 3166-1 alpha-3)
  LK: 967, // Sri Lanka, (ISO 3166-1 alpha-2)
  LKA: 967, // Sri Lanka (ISO 3166-1 alpha-3)
  SD: 971, // Sudan, (ISO 3166-1 alpha-2)
  SDN: 971, // Sudan (ISO 3166-1 alpha-3)
  SR: 977, // Suriname, (ISO 3166-1 alpha-2)
  SUR: 977, // Suriname, (ISO 3166-1 alpha-3)
  SE: 983, // Sweden, (ISO 3166-1 alpha-2)
  SWE: 983, // Sweden (ISO 3166-1 alpha-3)
  CH: 991, // Switzerland, (ISO 3166-1 alpha-2)
  CHE: 991, // Switzerland (ISO 3166-1 alpha-3)
  // We do not service Syria
  // SY: 997, // Syrian Arab Republic, (ISO 3166-1 alpha-2)
  // SYR: 997, // Syrian Arab Republic (ISO 3166-1 alpha-3)
  TJ: 1009, // Tajikistan, (ISO 3166-1 alpha-2)
  TJK: 1009, // Tajikistan (ISO 3166-1 alpha-3)
  TZ: 1013, // "Tanzania, United Republic of", (ISO 3166-1 alpha-2)
  TZA: 1013, // Tanzania, United Republic of (ISO 3166-1 alpha-3)
  TH: 1019, // Thailand, (ISO 3166-1 alpha-2)
  THA: 1019, // Thailand (ISO 3166-1 alpha-3)
  TL: 1021, // Timor-Leste, (ISO 3166-1 alpha-2)
  TLS: 1021, // Timor-Leste, (ISO 3166-1 alpha-3)
  TG: 1031, // Togo, (ISO 3166-1 alpha-2)
  TGO: 1031, // Togo (ISO 3166-1 alpha-3)
  TO: 1033, // Tonga, (ISO 3166-1 alpha-2)
  TON: 1033, // Tonga, (ISO 3166-1 alpha-3)
  TT: 1039, // Trinidad and Tobago, (ISO 3166-1 alpha-2)
  TTO: 1039, // Trinidad and Tobago (ISO 3166-1 alpha-3)
  TN: 1049, // Tunisia, (ISO 3166-1 alpha-2)
  TUN: 1049, // Tunisia (ISO 3166-1 alpha-3)
  TR: 1051, // Türkiye, (ISO 3166-1 alpha-2)
  TUR: 1051, // Türkiye (ISO 3166-1 alpha-3)
  TM: 1061, // Turkmenistan, (ISO 3166-1 alpha-2)
  TKM: 1061, // Turkmenistan (ISO 3166-1 alpha-3)
  TV: 1063, // Tuvalu, (ISO 3166-1 alpha-2)
  TUV: 1063, // Tuvalu (ISO 3166-1 alpha-3)
  UG: 1069, // Uganda, (ISO 3166-1 alpha-2)
  UGA: 1069, // Uganda (ISO 3166-1 alpha-3)
  UA: 1087, // Ukraine (ISO 3166-1 alpha-2)
  UKR: 1087, // Ukraine (ISO 3166-1 alpha-3)
  AE: 1091, // United Arab Emirates (ISO 3166-1 alpha-2)
  ARE: 1091, // United Arab Emirates (ISO 3166-1 alpha-3)
  GB: 1093, // United Kingdom (ISO 3166-1 alpha-2)
  GBR: 1093, // United Kingdom (ISO 3166-1 alpha-3)
  AF: 1097, // Afghanistan (ISO 3166-1 alpha-2)
  AFG: 1097, // Afghanistan (ISO 3166-1 alpha-3)
  UY: 1103, // Uruguay (ISO 3166-1 alpha-2)
  URY: 1103, // Uruguay (ISO 3166-1 alpha-3)
  UZ: 1109, // Uzbekistan (ISO 3166-1 alpha-2)
  UZB: 1109, // Uzbekistan (ISO 3166-1 alpha-3)
  VU: 1117, // Vanuatu (ISO 3166-1 alpha-2)
  VUT: 1117, // Vanuatu (ISO 3166-1 alpha-3)
  VE: 1123, // "Venezuela, Bolivarian Republic of" (ISO 3166-1 alpha-2)
  VEN: 1123, // "Venezuela, Bolivarian Republic of" (ISO 3166-1 alpha-3)
  VN: 1129, // Viet Nam (ISO 3166-1 alpha-2)
  VNM: 1129, // Viet Nam (ISO 3166-1 alpha-3)
  YE: 1151, // Yemen (ISO 3166-1 alpha-2)
  YEM: 1151, // Yemen (ISO 3166-1 alpha-3)
  ZM: 1153, // Zambia (ISO 3166-1 alpha-2)
  ZMB: 1153, // Zambia (ISO 3166-1 alpha-3)
  ZW: 1163, // Zimbabwe (ISO 3166-1 alpha-2)
  ZWE: 1163, // Zimbabwe (ISO 3166-1 alpha-3)
  HK: 1171, // Hong Kong (ISO 3166-1 alpha-2)
  HKG: 1171, // Hong Kong (ISO 3166-1 alpha-3)
  TW: 1181, // "Taiwan, Province of China", (ISO 3166-1 alpha-2)
  TWN: 1181, // "Taiwan, Province of China" (ISO 3166-1 alpha-3)

  // ABW: n, // Aruba (ISO 3166-1 alpha-3)
  // BMU: n, // Bermuda (ISO 3166-1 alpha-3)
  // CYM: n, // Cayman Islands (ISO 3166-1 alpha-3)
  // COK: n, // Cook Islands (ISO 3166-1 alpha-3)
  // FRO: n, // Faroe Islands (ISO 3166-1 alpha-3)
  // GIB: n, // Gibraltar (ISO 3166-1 alpha-3)
  // GGY: n, // Guernsey (ISO 3166-1 alpha-3)
  // IMN: n, // Isle of Man (ISO 3166-1 alpha-3)
  // JEY: n, // Jersey (ISO 3166-1 alpha-3)
  // MSR: n, // Montserrat (ISO 3166-1 alpha-3)
  // NFK: n, // Norfolk Island (ISO 3166-1 alpha-3)
  // PSE: n, // Palestine, State of (ISO 3166-1 alpha-3)
  // TCA: n, // Turks and Caicos Islands (ISO 3166-1 alpha-3)
  // VGB: n, // Virgin Islands (British) (ISO 3166-1 alpha-3)
  // ALA: n, // Åland Islands (ISO 3166-1 alpha-3)
};

export const faceTecCountryNameToCode = {
  "Afghanistan": "AF",
  "Albania": "AL",
  "Algeria": "DZ",
  "Andorra": "AD",
  "Angola": "AO",
  "Antigua and Barbuda": "AG",
  "Argentina": "AR",
  "Armenia": "AM",
  // "Aruba": "AW"
  "Australia": "AU",
  "Austria": "AT",
  "Azerbaijan": "AZ",
  "Bahamas": "BS",
  "Bahrain": "BH",
  "Bangladesh": "BD",
  "Barbados": "BB",
  "Belarus": "BY",
  "Belgium": "BE",
  "Belize": "BZ",
  "Benin": "BJ",
  // "Bermuda": "BM", 
  "Bhutan": "BT",
  "Bolivia": "BO",
  "Bosnia and Herzegovina": "BA",
  "Botswana": "BW",
  "Brazil": "BR",
  "Brunei": "BN",
  "Bulgaria": "BG",
  "Burkina Faso": "BF",
  "Burundi": "BI",
  // "Cabo Verde": 
  "Cambodia": "KH",
  "Cameroon": "CM",
  "Canada": "CA",
  // "Cayman Islands": 
  "Central Africa Republic": "CF",
  "Chad": "TD",
  "Chile": "CL",
  "China": "CN",
  "Colombia": "CO",
  "Comoros": "KM",
  "Congo": "CG",
  "Costa Rica": "CR",
  "Cote D'ivoire": "CI",
  "Croatia": "HR",
  // "Cuba": "CU",
  // "Curacao": "CW",
  "Cyprus": "CY",
  "Czechia": "CZ",
  "Democratic Republic of the Congo": "CD",
  "Denmark": "DK",
  "Djibouti": "DJ",
  "Dominica": "DM",
  "Dominican Republic": "DO",
  "Ecuador": "EC",
  "Egypt": "EG",
  "El Salvador": "SV",
  "Equatorial Guinea": "GQ",
  "Eritrea": "ER",
  "Estonia": "EE",
  "Eswatini": "SZ",
  "Ethiopia": "ET",
  "Fiji": "FJ",
  "Finland": "FI",
  "France": "FR",
  // "French Polynesia":
  "Gabon": "GA",
  "Gambia": "GM",
  "Georgia": "GE",
  "Germany": "DE",
  "Ghana": "GH",
  // "Gibraltar": "GI",
  "Greece": "GR",
  // "Greenland": "GL",
  "Grenada": "GD",
  // "Guam": "GU",
  "Guatemala": "GT",
  "Guinea": "GN",
  "Guinea-Bissau": "GW",
  "Guyana": "GY",
  "Haiti": "HT",
  "Honduras": "HN",
  "Hong Kong": "HK",
  "Hungary": "HU",
  "Iceland": "IS",
  "India": "IN",
  "Indonesia": "ID",
  // "Iran": "IR",
  "Iraq": "IQ",
  "Ireland": "IE",
  // "Isle of Man": "IM",
  "Israel": "IL",
  "Italy": "IT",
  "Jamaica": "JM",
  "Japan": "JP",
  "Jordan": "JO",
  "Kazakhstan": "KZ",
  "Kenya": "KE",
  // "Kosovo":
  "Kyrgyzstan": "KG",
  "Kuwait": "KW",
  "Laos": "LA",
  "Latvia": "LV",
  "Lebanon": "LB",
  "Lesotho": "LS",
  "Liberia": "LR",
  "Libya": "LY",
  "Liechtenstein": "LI",
  "Lithuania": "LT",
  "Luxembourg": "LU",
  // "Macao": "MO",
  "Madagascar": "MG",
  "Malawi": "MW",
  "Malaysia": "MY",
  "Maldives": "MV",
  "Mali": "ML",
  "Malta": "MT",
  "Mauritania": "MR",
  "Mauritius": "MU",
  "Mexico": "MX",
  "Moldova": "MD",
  "Monaco": "MC",
  "Mongolia": "MN",
  "Montenegro": "ME",
  "Morocco": "MA",
  "Mozambique": "MZ",
  "Myanmar": "MM",
  "Namibia": "NA",
  "Nepal": "NP",
  "Netherlands": "NL",
  "New Zealand": "NZ",
  "Nicaragua": "NI",
  "Niger": "NE",
  "Nigeria": "NG",
  "North Macedonia": "MK",
  "Norway": "NO",
  "Oman": "OM",
  "Pakistan": "PK",
  // "Palestine": "PS",
  "Panama": "PA",
  "Papua New Guinea": "PG",
  "Paraguay": "PY",
  "Peru": "PE",
  "Philippines": "PH",
  "Poland": "PL",
  "Portugal": "PT",
  // "Puerto Rico": "PR",
  "Republic of North Macedonia": "MK",
  "Qatar": "QA",
  "Romania": "RO",
  "Russia": "RU",
  "Rwanda": "RW",
  // "Saint Barthelemy": "BL",
  "Saint Kitts and Nevis": "KN",
  "Saint Lucia": "LC",
  "Saint Vincent and the Grenadines": "VC",
  "Sao Tome and Principe": "ST",
  "Saudi Arabia": "SA",
  "Senegal": "SN",
  "Serbia": "RS",
  "Seychelles": "SC",
  "Sierra Leone": "SL",
  "Singapore":  "SG",
  "Slovakia": "SK",
  "Slovenia": "SI",
  "Solomon Islands": "SB",
  "Somalia": "SO",
  // "Somaliland": "SO",
  "South Africa": "ZA",
  "South Korea": "KR",
  // "South Sudan": 
  "Spain": "ES",
  "Sri Lanka": "LK",
  "Sudan": "SD",
  "Suriname": "SR",
  "Swaziland": "SZ",
  "Sweden": "SE",
  "Switzerland": "CH",
  // "Syria": "SY",
  "Taiwan": "TW",
  "Tajikistan": "TJ",
  "Tanzania": "TZ",
  "Thailand": "TH",
  "Togo": "TG",
  "Trinidad and Tobago": "TT",
  "Tunisia": "TN",
  "Turkey": "TR",
  "Turkmenistan": "TM",
  "Uganda": "UG",
  "Ukraine": "UA",
  "United Arab Emirates": "AE",
  "United Kingdom": "GB",
  // "United Nations": "UN",
  "United States of America (the)": "US",
  "Uruguay": "UY",
  "Uzbekistan": "UZ",
  "Venezuela": "VE",
  "Vietnam": "VN",
  "Yemen": "YE",
  "Zambia": "ZM",
  "Zimbabwe": "ZW",
}

// Prefixes to block for PEP results from sanctions.io for Clean Hands
// Block EU countries, US, GB, and some other larger countries 
export const siIdentifierPrefixesToBlock = [
  'PEP-AF',
  'PEP-AM',
  'PEP-AZ',
  'PEP-BR',
  'PEP-CN',
  'PEP-EG',
  'PEP-IN',
  'PEP-IR',
  'PEP-IQ',
  'PEP-LY',
  'PEP-MM',
  'PEP-NG',
  'PEP-KP',
  'PEP-PK',
  'PEP-RU',
  'PEP-SO',
  'PEP-SY',
  'PEP-UA',
  'PEP-VE',
  'PEP-YE',
  // Sometimes sanctions io doesn't specify the country. We block these
  'PEP-UNSPECIFIED'
]
