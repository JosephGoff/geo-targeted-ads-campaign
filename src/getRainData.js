const axios = require("axios");
require("dotenv").config({ path: "../.env" });

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENCAGE_API_KEY = process.env.OPENCAGE_API_KEY;

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
    const results = res.data.results;
    if (!results || results.length === 0) {
      console.warn(`No results for (${lat},${lon})`);
      return null;
    }

    const result = results[0];
    const zip = result.components?.postcode || null;
    const location = result.formatted || null;

    if (!zip || !location || !location.includes("United States")) {
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
  console.log("Found heavy rain in", filtered.length, "grid points");

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

  const zones = enriched.filter(Boolean);
  
  const zipSet = new Set();
  zones.forEach((zone) => {
    if (zone.zip) {
      zipSet.add(zone.zip);
    }
  });
  const uniqueZips = Array.from(zipSet);
  return uniqueZips;
}

module.exports = { findHeavyRainZones };
