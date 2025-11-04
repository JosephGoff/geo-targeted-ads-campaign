require("dotenv").config();
const fs = require("fs");
const parse = require("csv-parse/sync").parse;
const axios = require("axios");

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const AD_SET_ID = process.env.AD_SET_ID;

if (!ACCESS_TOKEN || !AD_SET_ID) {
  console.error("❌ Missing ACCESS_TOKEN or AD_SET_ID in env variables");
  process.exit(1);
}

function loadZipMap(csvPath) {
  const csvData = fs.readFileSync(csvPath);
  const records = parse(csvData.toString(), {
    columns: true,
    skip_empty_lines: true,
  });

  const zipMap = {};
  records.forEach((row) => {
    const zip = row.zip.padStart(5, "0"); // Ensure leading zeros
    zipMap[zip] = {
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng),
    };
  });

  return zipMap;
}

function buildCustomLocations(zipMap, zipList) {
  return zipList
    .map((zip) => {
      const location = zipMap[zip];
      if (!location) {
        console.warn(`⚠️ ZIP ${zip} not found in dataset`);
        return null;
      }
      return {
        latitude: location.lat,
        longitude: location.lng,
        radius: 30,
        distance_unit: "mile",
      };
    })
    .filter(Boolean);
}

async function metaScript(zips) {
  const zipMap = loadZipMap("zips_data/uszips.csv");
  const customLocations = buildCustomLocations(zipMap, zips);

  const targeting = {
    geo_locations: {
      custom_locations: customLocations,
    },
    device_platforms: ["mobile"],
    user_os: ["iOS"],
  };

  console.log("✅ Targeting object ready for Meta Ads:");
  console.dir(targeting, { depth: null });

  await updateAdSetTargeting(targeting);
};

async function updateAdSetTargeting(targeting) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${AD_SET_ID}`,
      {
        targeting: targeting,
        access_token: ACCESS_TOKEN,
      }
    );

    console.log("✅ Ad set targeting updated successfully:");
    console.log(response.data);
  } catch (error) {
    if (error.response) {
      console.error("❌ API error:");
      console.error(error.response.data);
    } else {
      console.error("❌ Request failed:", error.message);
    }
  }
}

async function verifyAdSetTargeting() {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${AD_SET_ID}`,
      {
        params: {
          fields: "targeting",
          access_token: ACCESS_TOKEN,
        },
      }
    );

    console.log("✅ Current targeting config:");
    console.dir(response.data.targeting, { depth: null });
  } catch (error) {
    if (error.response) {
      console.error("❌ API error:");
      console.error(error.response.data);
    } else {
      console.error("❌ Request failed:", error.message);
    }
  }
}

module.exports = { metaScript };
