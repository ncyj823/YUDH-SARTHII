import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

import firebaseConfigRaw from '../../firebase-applet-config.json';

// Prefer environment variables, then fallback to local JSON config.
const firebaseConfig: any = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigRaw.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigRaw.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigRaw.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigRaw.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigRaw.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfigRaw.appId,
  databaseId: firebaseConfigRaw.firestoreDatabaseId
};

const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
] as const;

const missingConfigKeys = requiredConfigKeys.filter((key) => {
  const value = firebaseConfig[key];
  return !value || value === 'undefined' || String(value).trim() === '';
});

const isConfigValid = missingConfigKeys.length === 0;

if (!isConfigValid) {
  console.error(
    `Firebase config is incomplete. Missing keys: ${missingConfigKeys.join(', ')}. ` +
      'Set VITE_FIREBASE_* environment variables or fill firebase-applet-config.json.'
  );
}

const app = !getApps().length && isConfigValid ? initializeApp(firebaseConfig) : (getApps().length ? getApp() : null);
const auth = app ? getAuth(app) : null as any;
const db = app
  ? (firebaseConfig.databaseId
      ? getFirestore(app, firebaseConfig.databaseId)
      : getFirestore(app))
  : null as any;

if (db) {
  // Enable offline persistence
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence failed: Multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore persistence failed: Browser not supported');
    }
  });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { app, auth, db };
