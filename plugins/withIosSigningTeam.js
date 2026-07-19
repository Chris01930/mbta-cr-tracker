const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Expo config plugin: set the iOS development team + automatic signing on the
 * app target so real-device builds keep working after `expo prebuild` (which
 * regenerates the Xcode project without any team).
 *
 * Team id resolution (first non-empty wins):
 *   1. the `appleTeamId` plugin prop (see app.json)
 *   2. the APPLE_TEAM_ID environment variable
 *
 * Only the app target's build configs are touched (matched by bundle id), never
 * the Pods project.
 *
 * @param {import('@expo/config-plugins').ExpoConfig} config
 * @param {{ appleTeamId?: string }} [props]
 */
module.exports = function withIosSigningTeam(config, props = {}) {
  const teamId = props.appleTeamId || process.env.APPLE_TEAM_ID;

  // EAS injects its own managed distribution signing (manual style) after
  // prebuild; forcing automatic signing here would conflict. Only apply for
  // local builds.
  if (process.env.EAS_BUILD) {
    return config;
  }

  return withXcodeProject(config, (cfg) => {
    if (!teamId) {
      // No team configured — leave signing as-is (e.g. CI that signs elsewhere).
      return cfg;
    }
    const bundleId = cfg.ios && cfg.ios.bundleIdentifier;
    const project = cfg.modResults;
    const buildConfigs = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(buildConfigs)) {
      const entry = buildConfigs[key];
      const settings = entry && entry.buildSettings;
      if (!settings || !settings.PRODUCT_BUNDLE_IDENTIFIER) continue;
      // pbxproj values may be quoted; normalize before comparing.
      const bid = String(settings.PRODUCT_BUNDLE_IDENTIFIER).replace(/"/g, '');
      if (bundleId && bid === bundleId) {
        settings.DEVELOPMENT_TEAM = teamId;
        settings.CODE_SIGN_STYLE = 'Automatic';
      }
    }
    return cfg;
  });
};
