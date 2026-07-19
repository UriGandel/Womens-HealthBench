const {
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
  withGradleProperties,
  withInfoPlist,
  withProjectBuildGradle,
} = require("@expo/config-plugins");

const MIN_ANDROID_SDK = 26;
const LEGACY_MIN_SDK_BLOCK = `

// expo-health-data: Health Connect requires Android 8+
rootProject.ext.minSdkVersion = Math.max(rootProject.ext.minSdkVersion as int, 26)
`;

const READ_PERMISSIONS = [
  "android.permission.health.READ_SLEEP",
  "android.permission.health.READ_STEPS",
  "android.permission.health.READ_EXERCISE",
  "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
  "android.permission.health.READ_RESTING_HEART_RATE",
  "android.permission.health.READ_HEART_RATE_VARIABILITY",
  "android.permission.health.READ_RESPIRATORY_RATE",
  "android.permission.health.READ_OXYGEN_SATURATION",
  "android.permission.health.READ_SKIN_TEMPERATURE",
];

function withHealthKit(config) {
  config = withEntitlementsPlist(config, (result) => {
    result.modResults["com.apple.developer.healthkit"] = true;
    return result;
  });
  return withInfoPlist(config, (result) => {
    result.modResults.NSHealthShareUsageDescription =
      "Allow Tomorrow, Gently to read daily sleep, activity, and vital-sign summaries for your symptom research and experimental forecast.";
    return result;
  });
}

function withHealthConnect(config) {
  config = withGradleProperties(config, (result) => {
    const property = result.modResults.find(
      (entry) =>
        entry.type === "property" && entry.key === "android.minSdkVersion",
    );
    const configuredMinSdk = Number.parseInt(property?.value ?? "", 10);
    const minSdk = Math.max(configuredMinSdk || 0, MIN_ANDROID_SDK).toString();

    if (property) {
      property.value = minSdk;
    } else {
      result.modResults.push({
        type: "property",
        key: "android.minSdkVersion",
        value: minSdk,
      });
    }
    return result;
  });
  config = withProjectBuildGradle(config, (result) => {
    result.modResults.contents = result.modResults.contents.replace(
      LEGACY_MIN_SDK_BLOCK,
      "",
    );
    return result;
  });
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    for (const permission of READ_PERMISSIONS) {
      AndroidConfig.Permissions.addPermission(result.modResults, permission);
    }

    manifest.queries ??= [];
    const queries = manifest.queries[0] ?? { package: [] };
    queries.package ??= [];
    if (
      !queries.package.some(
        (entry) => entry.$?.["android:name"] === "com.google.android.apps.healthdata",
      )
    ) {
      queries.package.push({
        $: { "android:name": "com.google.android.apps.healthdata" },
      });
    }
    manifest.queries[0] = queries;

    const application = manifest.application?.[0];
    if (application) {
      application["activity-alias"] ??= [];
      if (
        !application["activity-alias"].some(
          (entry) => entry.$?.["android:name"] === "ViewPermissionUsageActivity",
        )
      ) {
        application["activity-alias"].push({
          $: {
            "android:name": "ViewPermissionUsageActivity",
            "android:exported": "true",
            "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
            "android:targetActivity": ".MainActivity",
          },
          "intent-filter": [
            {
              action: [
                { $: { "android:name": "android.intent.action.VIEW_PERMISSION_USAGE" } },
              ],
              category: [
                { $: { "android:name": "android.intent.category.HEALTH_PERMISSIONS" } },
              ],
            },
          ],
        });
      }
    }
    return result;
  });
}

module.exports = function withExpoHealthData(config) {
  return withHealthConnect(withHealthKit(config));
};
