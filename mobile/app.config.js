// Extends app.json.
// - Test builds that talk to the laptop over plain http:// need Android's "cleartext traffic"
//   switched on; builds that use an https:// server keep it off.
// - Android push needs Firebase's google-services.json. It is not in git (public repo): on EAS it
//   comes from the file variable GOOGLE_SERVICES_JSON, locally from mobile/google-services.json.
const fs = require('fs');

module.exports = ({ config }) => {
  const plainHttp = (process.env.EXPO_PUBLIC_API_URL || '').startsWith('http://');
  const firebase = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync('./google-services.json') ? './google-services.json' : undefined);
  return {
    ...config,
    android: { ...config.android, ...(firebase ? { googleServicesFile: firebase } : {}) },
    // When this app was built, shown at the bottom of More so you can tell which APK a phone has.
    extra: { ...config.extra, builtAt: new Date().toISOString() },
    plugins: [...(config.plugins || []), ['expo-build-properties', { android: { usesCleartextTraffic: plainHttp } }]],
  };
};
