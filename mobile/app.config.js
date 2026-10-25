// Extends app.json. Test builds that talk to the laptop over plain http:// need Android's
// "cleartext traffic" switched on; builds that use an https:// server keep it off.
module.exports = ({ config }) => {
  const plainHttp = (process.env.EXPO_PUBLIC_API_URL || '').startsWith('http://');
  return {
    ...config,
    plugins: [...(config.plugins || []), ['expo-build-properties', { android: { usesCleartextTraffic: plainHttp } }]],
  };
};
