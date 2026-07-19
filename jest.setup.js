// Mock AsyncStorage with the official in-memory jest mock so the config store's
// cache reads/writes work under test.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
