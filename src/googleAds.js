require("dotenv").config({ path: "../.env" });

async function setCampaignLocations(customer, customerId, geoIds) {
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
      "Existing campaign locations: ",
      existingCriteria.length
      // existingCriteria.map((c) => c.resource_name)
    );

    // Step 2: Remove existing location criteria
    if (existingCriteria.length) {
      console.log("Removing all locations...");

      await customer.campaignCriteria.remove(
        existingCriteria.map((crit) => crit.resource_name)
      );
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
      `✅ Set campaign ${campaignId} to target ${geoIds.length} geo IDs\n`
    );
  } catch (error) {
    console.error("⚠️ Google Ads Update Error: ", error);
    if (error instanceof Error) {
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
    }
    console.error("Raw error object:", error);
  }
}

async function fetchCampaigns(customer) {
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

module.exports = { setCampaignLocations, fetchCampaigns };
