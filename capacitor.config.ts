import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.personal.swarify',
  appName: 'Swarify',
  webDir: 'dist',
  android: { allowMixedContent: true },
  server: { androidScheme: 'https' },
};
export default config;
