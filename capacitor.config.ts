import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.examtrack.app',
  appName: 'capstone',
  webDir: 'www',

  server: {
    hostname: 'localhost',
    androidScheme: 'https'
  }
};

export default config;
