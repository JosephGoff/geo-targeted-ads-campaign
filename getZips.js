const axios = require("axios");
const fs = require("fs");
const readline = require("readline");
const xlsx = require("xlsx");

const pad = (num, size) => num.toString().padStart(size, "0");

// Step 1: Load UGC → County FIPS from national_county.txt
const loadCountyFIPSFromUGC = async (ugcCode) => {
  const stateAbbr = ugcCode.slice(0, 2); // e.g., 'MD'
  const countyCode = ugcCode.slice(3); // e.g., '031'

  const fileStream = fs.createReadStream("./national_county.txt");
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  const fipsList = [];
  for await (const line of rl) {
    const [state, stateFIPS, countyFIPS, countyName, classCode] =
      line.split(",");

    if (state === stateAbbr && pad(countyFIPS, 3) === countyCode) {
      const fullFIPS = pad(stateFIPS, 2) + pad(countyFIPS, 3);
      fipsList.push(fullFIPS);
    }
  }
  return fipsList;
};

// Step 2: Load ZIPs from XLSX for given county FIPS codes
const loadZIPsFromFIPS = (fipsList) => {
  const workbook = xlsx.readFile("./zip_county.xlsx");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  const zipSet = new Set();
  for (const row of rows) {
    const zip = String(
      row.ZIP || row.zip || row.Zip || row["ZIP CODE"] || ""
    ).padStart(5, "0");
    const countyFIPS = String(
      row.COUNTY || row["COUNTY FIPS"] || row["COUNTYFP"] || ""
    ).padStart(5, "0");
    if (fipsList.includes(countyFIPS)) {
      zipSet.add(zip);
    }
  }
  return Array.from(zipSet);
};

const getZipsForUGC = async (ugcCode) => {
  const countyFIPSList = await loadCountyFIPSFromUGC(ugcCode);
  if (countyFIPSList.length === 0) {
    return [];
  }
  const zips = loadZIPsFromFIPS(countyFIPSList);
  return zips;
};

async function getLatestNwsAlerts() {
  const url = "https://api.weather.gov/alerts/active";
  const allZipSet = new Set();

  try {
    const res = await axios.get(url);
    const alerts = res.data.features;
    console.log("TOTAL NWS ALERTS: ", alerts.length);

    const filteredAlerts = [];
    for (const alert of alerts) {
      const event = alert.properties.event;

      const isRainRelated =
        event &&
        ["rain", "storm"].some((kw) => event.toLowerCase().includes(kw));
      const isFloodRelated =
        event && ["flood"].some((kw) => event.toLowerCase().includes(kw));

      if (isRainRelated) {
        filteredAlerts.push(alert);
      }
    }
    console.log("TOTAL RAIN RELATED ALERTS: ", filteredAlerts.length);

    for (const alert of filteredAlerts) {
      const UGC = alert.properties.geocode.UGC;
      if (UGC.length > 0) {
        const allZips = (
          await Promise.all(UGC.map((code) => getZipsForUGC(code)))
        ).flat();
        let addedCount = 0;
        for (const zip of allZips) {
          if (addedCount >= 30) break;
          if (!allZipSet.has(zip)) {
            allZipSet.add(zip);
            addedCount++;
          }
        }
      }
    }
    const allUniqueZips = [...allZipSet];
    console.log("ALL TARGETED ZIPS", allUniqueZips);

    return allUniqueZips;
  } catch (err) {
    console.error("Failed to fetch NWS alerts:", err.message);
    return [];
  }
}

function getRandomSample(arr, n) {
  return arr
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, n)
    .map(({ value }) => value);
}

async function getRandom100ZipCodes() {
  const zipCodes = await getLatestNwsAlerts();
  const sample100 = getRandomSample(zipCodes, 100);
  return sample100;
}

module.exports = { getRandom100ZipCodes };
