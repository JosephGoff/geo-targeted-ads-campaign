require("dotenv").config({ path: "../.env" });

// Google Cloud Function Logs
// https://console.cloud.google.com/run/detail/us-central1/dailytask/observability/logs?inv=1&invt=AbywIQ&project=floodalertupgrade-edgar-1
// https://console.cloud.google.com/run/detail/us-central1/runcampaignupdatelogictask/observability/logs?inv=1&invt=AbywIQ&project=floodalertupgrade-edgar-1

// Google Cloud Scheduler Logs
// https://console.cloud.google.com/cloudscheduler?inv=1&invt=AbywIA&project=floodalertupgrade-edgar-1


// COMMANDS
// Created queue like this:
// gcloud tasks queues create ads-update-queue \
//   --location=us-central1

// Initialize daily task
function logInitializeCloudCommand() {
  console.log(
    `\n
    gcloud functions deploy dailyTask \\
    --runtime=nodejs20 \\
    --trigger-http \\
    --allow-unauthenticated \\
    --entry-point=dailyTask \\
    --region=us-central1 \\
    --memory=512MB \\
    --set-env-vars="PROJECT_ID=${process.env.PROJECT_ID},
      QUEUE_ID=${process.env.QUEUE_ID}"
      \n`
  );
}

// Initialize runcampaignupdatelogictask which runs main logic
function logDeployCommand() {
  console.log(
    `\n
    gcloud functions deploy runCampaignUpdateLogicTask \\
  --runtime=nodejs20 \\
  --trigger-http \\
  --allow-unauthenticated \\
  --entry-point=runCampaignUpdateLogicTask \\
  --region=us-central1 \\
  --memory=1GiB \\
  --timeout=300s \\
  --set-env-vars="GOOGLE_ADS_CLIENT_ID=${process.env.GOOGLE_ADS_CLIENT_ID},
    GOOGLE_ADS_CLIENT_SECRET=${process.env.GOOGLE_ADS_CLIENT_SECRET},
    GOOGLE_ADS_DEVELOPER_TOKEN=${process.env.GOOGLE_ADS_DEVELOPER_TOKEN},
    GOOGLE_ADS_REFRESH_TOKEN=${process.env.GOOGLE_ADS_REFRESH_TOKEN},
    GOOGLE_ADS_CUSTOMER_ID=${process.env.GOOGLE_ADS_CUSTOMER_ID},
    OPENWEATHER_API_KEY=${process.env.OPENWEATHER_API_KEY},
    OPENCAGE_API_KEY=${process.env.OPENCAGE_API_KEY},
    PROJECT_ID=${process.env.PROJECT_ID},
    GOOGLE_ADS_CAMPAIGN_ID=${process.env.GOOGLE_ADS_CAMPAIGN_ID},
    ACCESS_TOKEN=${process.env.ACCESS_TOKEN},
    AD_SET_ID=${process.env.AD_SET_ID}" 
    \n`
  );
}

// Update schedule that runs the function once per day -> To create a schedule, simply replace "update" with "create"
function logSetScheduleCommand() {
  const hour = 17; // Military time 0-23
  const minutes = 33; // 0-59
  console.log(
    `\n
    gcloud scheduler jobs update http trigger-google-ads \\
      --schedule="${minutes} ${hour} * * *" \\
      --uri="https://us-central1-floodalertupgrade-edgar-1.cloudfunctions.net/dailyTask" \\
      --http-method=POST \\
      --time-zone="America/New_York" \\
      --location=us-central1
    \n`
  );
}

// LOG RELEVANT COMMANDS

logDeployCommand()
logSetScheduleCommand()