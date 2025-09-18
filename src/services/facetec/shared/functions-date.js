import moment from "moment";
import { getDateAsInt } from "../../../utils/utils.js";
import { ethers } from "ethers";
import { poseidon } from "circomlibjs-old";

function splitDateString(dateStr) {
  // Extract all alphanumeric words (numbers or letters)
  return dateStr.match(/[A-Za-zÀ-ÿ0-9]+/g) || [];
}

export function parseOCRStringToDate(dateStr) {
  const parts = splitDateString(dateStr);
  if(parts.length != 3) return null;

  let has4digits = false;
  let hasMonthName = false;

  // for each part, 
  // check if it is 1 digit, if so prepend with 0
  // if length is not 2 or 4, return null
  for(let i = 0; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) {
      // It's all digits
      if (parts[i].length === 1) {
        parts[i] = "0" + parts[i];
      } else if (parts[i].length == 4) {
        has4digits = true;
      } else if (parts[i].length != 2 && parts[i].length != 4) {
        return null;
      }
    } else {
      hasMonthName = true;
    }
  }
  dateStr = parts.join("-");

  let formats = [];
  if(hasMonthName) {
    formats = [
      'YYYY-MMM-DD', // Example: '2023-Dec-31'
      'YYYY-MMMM-DD', // Example: '2023-December-31'
      'DD-MMM-YYYY', // Example: '31-Dec-2023'
      'DD-MMMM-YYYY', // Example: '31-December-2023'
      'MMM-DD-YYYY', // Example: 'Dec-31-2023'
      'MMMM-DD-YYYY', // Example: 'December-31-2023'
      'YY-MMM-DD', // Example: '23-Dec-31'
      'YY-MMMM-DD', // Example: '23-December-31'
      'DD-MMM-YY', // Example: '31-Dec-23'
      'DD-MMMM-YY', // Example: '31-December-23'
      'MMM-DD-YY', // Example: 'Dec-31-23'
      'MMMM-DD-YY', // Example: 'December-31-23'
    ];
  } else {
    if(has4digits) {
      formats = [
        'YYYY-MM-DD', // Example: '2023-12-31'
        'DD-MM-YYYY', // Example: '31-12-2023'
        'MM-DD-YYYY', // Example: '12-31-2023'
      ];
    } else {
      formats = [
        'DD-MM-YY', // Example: '31-12-23'
        'MM-DD-YY', // Example: '12-31-23'
        'YY-MM-DD', // Example: '23-12-31'
      ];
    }
  }

  for (let format of formats) {
    const date = moment(dateStr, format, true); // Using moment.js for parsing

    if (date.isValid()) {
      return date.toDate().toISOString().split('T')[0]; // Return Date object if conversion succeeds
    }
  }

  return null; // Return null if no format matches the date
}

// just for easier testing from GET /test-ocr-date-parsing
export async function testOCRDateParsing(req, res) {
  const dates = [
    "25-Dec-2023",
    "2023/12/25",
    "12/25/2023",
    "25 December 2023",
    "23-11-2",
    "3-12-25",
    "25-Dec-35",
    "25-Dec-2023",
    "25-Dec-23",
    "Dec-25-2023",
    "Dec-25-23",
    "25-23-Dec",
    "23-25-Dec",
    "23-33-Dec",
    "33-23-Dec",
    "2023/12/25",
    "12/25/2023",
    "25/December/2023",
    "23-11-2",
    "3-12-25",
    "15-8-1985",
    "8-15-1985",
    "15-8-2025",
    "8-15-2025",
    "15-8-25",
    "8-15-25",
    "0-122-12",
    "1-10-00",
    "1-10-2000",
    "00-10-1",
    "2000-10-1",
  ];

  const results = dates.map((date) => `${date}: ${parseOCRStringToDate(date)}`);

  return res.status(200).json({
    results,
  });
}
