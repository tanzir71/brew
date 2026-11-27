import type { ReaderAccessStatus } from './reader-sync.js';

export interface ReaderAccessSettings extends ReaderAccessStatus {
  serverUrl: string;
  googleReaderUrl: string;
  feverUrl: string;
}
export function readerServerUrls(base: string) {
  const serverUrl = new URL(base).origin;
  return {
    serverUrl,
    googleReaderUrl: new URL('/api/greader', serverUrl).href,
    feverUrl: new URL('/api/fever', serverUrl).href,
  };
}
export const readerAppClients = [
  {
    name: 'Reeder Classic',
    protocol: 'Google Reader',
    account: 'FreshRSS',
    steps: [
      'Add a FreshRSS account in Reeder Classic.',
      'Use the full Google Reader URL above as the server address.',
      'Enter your Brew app username and generated app password, then sync.',
    ],
    guide: 'https://www.reeder.app/classic/',
  },
  {
    name: 'NetNewsWire',
    protocol: 'Google Reader',
    account: 'FreshRSS',
    steps: [
      'In Settings → Accounts, add a FreshRSS account.',
      'Paste the full Google Reader URL into the API URL field.',
      'Enter your Brew app username and generated app password, then sync.',
    ],
    guide: 'https://github.com/Ranchero-Software/NetNewsWire/issues/3731',
  },
  {
    name: 'Unread',
    protocol: 'Fever',
    account: 'Fever',
    steps: [
      'Add a Fever account in Unread.',
      'Use the full Fever URL above as the server address.',
      'Enter your Brew app username and generated app password. Unread handles the Fever sign-in key.',
    ],
    guide: 'https://www.goldenhillsoftware.com/unread/migrating-from-fever-account/',
  },
] as const;
