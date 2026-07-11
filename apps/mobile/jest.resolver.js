/**
 * Composes the two resolvers this app needs (jest allows only one `resolver`):
 *
 * 1. react-native-worklets' jest resolver — strips the `.native` extensions when resolving inside
 *    react-native-worklets so its pure-JS implementation loads instead of the native module
 *    (whose import-time init throws under jest). Reanimated 4 imports worklets unconditionally,
 *    so without this every suite that touches reanimated dies before running.
 * 2. @react-native/jest-preset's resolver (what jest-expo would otherwise install) — drops the
 *    react-native package's `exports` map so jest can resolve/mock its subpaths.
 */
const rnResolver = require('@react-native/jest-preset/jest/resolver.js');

module.exports = (request, options) => {
  if (
    options.basedir.includes('react-native-worklets') ||
    request.includes('react-native-worklets')
  ) {
    options = {
      ...options,
      extensions: options.extensions?.filter((ext) => !ext.includes('native')),
    };
  }
  return rnResolver(request, options);
};
