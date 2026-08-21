// Dynamic Expo config.
//
// Everything lives in app.json (Expo loads it as the base `config` below);
// this file exists solely to inject the native Google Sign-In config plugin
// with an iOS URL scheme derived from an env var, which static app.json cannot
// do. app.json is left untouched as the source of truth for everything else.
//
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is the iOS OAuth client id
// (e.g. 1084366774946-abcd.apps.googleusercontent.com). Its reversed form is
// the URL scheme iOS uses to return from the Google sheet:
//   com.googleusercontent.apps.1084366774946-abcd
//
// This MUST be set (locally in mobile/.env, and in the EAS build env) BEFORE
// running `expo prebuild` / an EAS build. If it is unset the plugin is skipped
// and native Google sign-in will not have a redirect scheme — a warning is
// printed so it is not silent.
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  const plugins = [...(config.plugins || [])];

  // Native Sign in with Apple (App Review Guideline 4.8: the app offers Google
  // sign-in, so Apple requires an equivalent). This config plugin adds the
  // `com.apple.developer.applesignin` entitlement, which is what makes EAS
  // provision the "Sign in with Apple" capability for the app id. It takes no
  // options and is safe to add unconditionally — it is a no-op at runtime on
  // non-Apple platforms. A native iOS app authenticates against its own bundle
  // id (com.wagerpals.app), so NO separate Apple Services ID is required.
  plugins.push('expo-apple-authentication');

  if (iosClientId) {
    const reversed =
      'com.googleusercontent.apps.' +
      iosClientId.replace(/\.apps\.googleusercontent\.com$/, '');
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: reversed },
    ]);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[app.config] EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is not set; native Google Sign-In URL scheme will NOT be added. Set it before prebuild/build.'
    );
  }

  return { ...config, plugins };
};
