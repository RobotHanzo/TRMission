module.exports = (api) => {
  api.cache(true);
  // react-native-worklets/plugin (Reanimated 4 split worklets into their own package) MUST be last.
  return { presets: ['babel-preset-expo'], plugins: ['react-native-worklets/plugin'] };
};
