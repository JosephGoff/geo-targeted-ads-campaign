// Set Google Ads Location Functions - Joseph Goff 2025
const { CloudTasksClient } = require("@google-cloud/tasks");
const { GoogleAdsApi } = require("google-ads-api");
const fs = require("fs");
const csv = require("csv-parser");
const bodyParser = require("body-parser");
const express = require("express");
const { getRandom100ZipCodes } = require("./getZips");
const { metaScript } = require("./meta");
const { findHeavyRainZones } = require("./getRainData");
const { setCampaignLocations } = require("./googleAds");
require("dotenv").config({ path: "../.env" });

const app = express();
app.use(bodyParser.json());

const PROJECT_ID = process.env.PROJECT_ID;
const QUEUE_ID = process.env.QUEUE_ID;
const LOCATION = "us-central1";

// FUNCTIONS
// === Triggered daily by Cloud Scheduler ===
exports.dailyTask = async (req, res) => {
  const client = new CloudTasksClient();
  const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_ID);
  console.log("Queue path:", parent);

  const task = {
    httpRequest: {
      httpMethod: "POST",
      url: `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/runCampaignUpdateLogicTask`,
      headers: {
        "Content-Type": "application/json",
      },
      body: Buffer.from(JSON.stringify({})).toString("base64"),
    },
  };

  await client.createTask({ parent, task });

  res.status(200).send("Task enqueued.");
};

// === Background task that does the actual work ===
exports.runCampaignUpdateLogicTask = async (req, res) => {
  console.log("Running campaign update logic...");

  try {
    await runCampaignUpdateLogic();
    res.status(200).send("Campaign update complete.");
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).send("Error updating campaign.");
  }
};

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
});

const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

const customer = client.Customer({
  customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
});

let geoIndex = null;

function loadGeoData() {
  return new Promise((resolve, reject) => {
    const geoFilePath = "../files/geotargets.csv";
    const index = {};

    fs.createReadStream(geoFilePath)
      .pipe(csv())
      .on("data", (row) => {
        if (
          row["Target Type"] === "Postal Code" &&
          row["Status"] === "Active" &&
          row["Country Code"] === "US"
        ) {
          const zip = row["Canonical Name"]?.split(",")[0];
          if (zip) {
            index[zip] = row["Criteria ID"];
          }
        }
      })
      .on("end", () => {
        geoIndex = index;
        resolve();
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

function getGeoIdFromZip(zip) {
  if (!geoIndex) throw new Error("Geo index not loaded yet");
  const id = geoIndex[zip];
  if (id) return id;
  else throw new Error(`No geo target found for ZIP code ${zip}`);
}

async function runCampaignUpdateLogic() {
  // STEP 1 -> Acquire a list of zip codes to use for campaigns
  console.log("\nSTEP 1: Acquiring zip codes for campaign targeting");

  // Fetch 100 random zip codes from NWS rain alerts
  let zips = await getRandom100ZipCodes();

  // Fall back to use heavy rain forecast from Open Weather if no zips come from NWS
  if (!zips.length) {
    console.log("\nFalling back to OPEN WEATHER API to acquire zip codes");
    zips = await findHeavyRainZones();
  }

  console.log("\nFinal zip codes: ", zips);

  // STEP 2 -> Convert zip codes to geo ids for google ads
  console.log("\nSTEP 2: Converting zip codes to geo IDs for Google Ads");
  await loadGeoData();
  const geoIds = [];
  for (const zip of zips) {
    try {
      const id = getGeoIdFromZip(zip);
      geoIds.push(id);
    } catch (e) {
      console.warn(e.message);
    }
  }

  // STEP 3 -> Set campaign locations
  console.log("\nSTEP 3: Setting campaign locations");

  // Meta
  if (zips.length) {
    // Meta API Key is not functioning right now...
    // await metaScript(zips);
  } else {
    console.error("No zip codes returned, aborting meta campaign update.");
  }

  // Google Ads
  if (geoIds.length) {
    console.log(
      "Setting campaign locations in Google Ads for ",
      geoIds.length + " geo Ids"
    );
    await setCampaignLocations(customer, customerId, geoIds);
  } else {
    console.error(
      "No geo IDs found for zip codes, aborting Google Ads campaign update."
    );
  }
}

runCampaignUpdateLogic();
