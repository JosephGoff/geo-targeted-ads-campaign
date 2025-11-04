const { CloudTasksClient } = require("@google-cloud/tasks");
const { GoogleAdsApi } = require("google-ads-api");
const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser");
const bodyParser = require("body-parser");
const express = require("express");
require("dotenv").config();
const { getRandom100ZipCodes } = require("./getZips");
const { metaScript } = require("./meta");

const app = express();
app.use(bodyParser.json());

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENCAGE_API_KEY = process.env.OPENCAGE_API_KEY;
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

  // const parent = client.queuePath(PROJECT_ID, LOCATION, QUEUE_ID);

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

// 1. Lat/Lon grid across US
const latitudes = Array.from({ length: 19 }, (_, i) => 25 + i * 2.5); // 25 to 70 every 2.5°
const longitudes = Array.from({ length: 25 }, (_, i) => -125 + i * 2.5); // -125 to -65 every 2.5°

// 2. Get rain forecast from /forecast endpoint (free tier)
async function getPrecipitationForecast(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${OPENWEATHER_API_KEY}`;

  try {
    const res = await axios.get(url);
    const forecasts = res.data.list;

    let totalRain = 0;
    let rainyPeriods = [];
    let hasHeavyPeriod = false;

    for (const entry of forecasts) {
      const rainVolume = entry.rain && entry.rain["3h"] ? entry.rain["3h"] : 0;
      if (rainVolume > 0) {
        rainyPeriods.push({
          time: entry.dt_txt,
          volume: rainVolume,
        });
        totalRain += rainVolume;

        if (rainVolume >= 0.5) {
          hasHeavyPeriod = true;
        }
      }
    }

    if (totalRain > 1.0 || hasHeavyPeriod) {
      return { lat, lon, totalRain, rainyPeriods };
    } else {
      return null;
    }
  } catch (err) {
    console.error(`Failed to get forecast for (${lat},${lon}):`, err.message);
    return null;
  }
}

// 3. Use OpenCage to reverse geocode to ZIP and location
async function reverseGeocode(lat, lon) {
  const url = `https://api.opencagedata.com/geocode/v1/json?q=${lat}+${lon}&key=${OPENCAGE_API_KEY}`;

  try {
    const res = await axios.get(url);
    const result = res.data.results[0];

    const zip = result.components.postcode || null;
    const location = result.formatted || null;

    if (
      zip === null ||
      location === null ||
      !location.includes("United States")
    ) {
      return null;
    }

    return { zip, location };
  } catch (err) {
    console.error(`Failed to reverse geocode (${lat},${lon}):`, err.message);
    return { zip: null, location: null };
  }
}

// 4. Main function: scan grid for heavy rain and enrich
async function findHeavyRainZones() {
  const tasks = [];

  for (const lat of latitudes) {
    for (const lon of longitudes) {
      tasks.push(getPrecipitationForecast(lat, lon));
    }
  }

  const results = await Promise.all(tasks);
  const filtered = results.filter(Boolean);

  const enriched = await Promise.all(
    filtered.map(async ({ lat, lon, totalRain, rainyPeriods }) => {
      const geo = await reverseGeocode(lat, lon);
      if (!geo) return null;
      const { zip, location } = geo;
      return {
        lat,
        lon,
        zip,
        location,
        totalRain: totalRain.toFixed(2),
        rainEvents: rainyPeriods.length,
        rainyPeriods,
      };
    })
  );

  return enriched.filter(Boolean);
}

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
    const geoFilePath = "./geotargets.csv";
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

async function setCampaignLocations(geoIds) {
  const campaignId = process.env.GOOGLE_ADS_CAMPAIGN_ID;
  try {
    // Step 1: Remove existing location criteria
    console.log("Fetching existing location criteria...");
    const query = `
      SELECT campaign_criterion.resource_name
      FROM campaign_criterion
      WHERE campaign.id = ${campaignId}
      AND campaign_criterion.location.geo_target_constant IS NOT NULL
    `;

    const response = await customer.query(query);
    const existingCriteria = response.map((row) => row.campaign_criterion);
    console.log(
      "Found existing:",
      existingCriteria.map((c) => c.resource_name)
    );

    // Step 2: Add new location criteria
    if (existingCriteria.length) {
      console.log(
        "Removing:",
        existingCriteria.map((c) => c.resource_name)
      );

      await customer.campaignCriteria.remove(
        existingCriteria.map((crit) => crit.resource_name)
      );
      console.log("Removed old locations.");
    }

    // Step 3: Add new location criteria
    const operations = geoIds.map((id) => ({
      campaign: `customers/${customerId}/campaigns/${campaignId}`,
      location: {
        geo_target_constant: `geoTargetConstants/${id}`,
      },
    }));

    await customer.campaignCriteria.create(operations);

    console.log(
      `Set campaign ${campaignId} to target geo IDs: ${geoIds.join(", ")}`
    );
  } catch (error) {
    console.error("Error: ", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
    }
    console.error("Raw error object:", error);
  }
}

async function fetchCampaigns() {
  try {
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status
      FROM
        campaign
      LIMIT
        10
    `);

    // Output the results
    console.log("Campaigns:", campaigns.length);
    campaigns.forEach((campaign) => {
      console.log(
        `ID: ${campaign.campaign.id}, Name: ${campaign.campaign.name}, Status: ${campaign.campaign.status}`
      );
    });
  } catch (error) {
    console.error("Error: ", error);
  }
}

async function runCampaignUpdateLogic() {
  // Previously used this code to get target areas using rainfall locations from open weather...
  // const filtered_zips = await findHeavyRainZones().then((zones) => {
  //   const zipSet = new Set();
  //   zones.forEach((zone) => {
  //     if (zone.zip) {
  //       zipSet.add(zone.zip);
  //     }
  //   });
  //   const uniqueZips = Array.from(zipSet);
  //   return uniqueZips;
  // });
  // if (!filtered_zips || filtered_zips.length === 0) {
  //   return;
  // }
  // console.log(filtered_zips)

  // const filtered_zips = zips;

  // const geo_results = await Promise.allSettled(
  //   filtered_zips.map((zip) => getGeoIdFromZip(zip))
  // );
  // const geo_zips = geo_results
  //   .filter((r) => r.status === "fulfilled")
  //   .map((r) => r.value);
  // const failed = geo_results
  //   .filter((r) => r.status === "rejected")
  //   .map((r, i) => ({
  //     zip: filtered_zips[i],
  //     error: r.reason,
  //   }));

  // Now using NWS instead
  const zips = await getRandom100ZipCodes();
  console.log(zips);
  await metaScript(zips);

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

  console.log("Mapped geo IDs:", geoIds);
  await customer.campaigns.update([
    {
      resource_name: `customers/${customerId}/campaigns/${process.env.GOOGLE_ADS_CAMPAIGN_ID}`,
      contains_eu_political_advertising:
        customer.enums.CampaignContainsEuPoliticalAdvertisingEnum
          .DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
    },
  ]);

  await setCampaignLocations(geoIds);
}

runCampaignUpdateLogic();
