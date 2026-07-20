const { withEntitlementsPlist } = require('@expo/config-plugins');

/**
 * Expo config plugin: remove the `aps-environment` (Apple Push) entitlement that
 * expo-notifications injects during prebuild.
 *
 * This app uses expo-notifications for LOCAL notifications only (heritage-arrival
 * alerts detected on-device) — there is no push server. Local notifications need
 * no entitlement, but the injected `aps-environment` forces the App Store
 * provisioning profile to carry the Push Notifications capability, which fails
 * signing on EAS ("profile doesn't include the aps-environment entitlement").
 * Stripping it keeps local notifications working and lets the build sign with a
 * standard profile. Add remote push (and this entitlement back) only if/when a
 * push server is introduced.
 */
module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
