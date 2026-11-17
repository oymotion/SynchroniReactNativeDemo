module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Required by react-native-worklets; must stay LAST in the plugin list.
    'react-native-worklets/plugin',
  ],
};
