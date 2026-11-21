import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket;

if (!projectId) {
  throw new Error('FIREBASE_PROJECT_ID or firebase-applet-config.json projectId is required');
}
if (!storageBucket) {
  throw new Error('FIREBASE_STORAGE_BUCKET or firebase-applet-config.json storageBucket is required');
}

// Uses the runtime's Application Default Credentials:
// - Cloud Run / Google Cloud: attached workload service account
// - local or private Docker host: GOOGLE_APPLICATION_CREDENTIALS
// Never store service-account JSON in the repository or client bundle.
const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      credential: applicationDefault(),
      projectId,
      storageBucket,
    });

export const adminAuth = getAuth(adminApp);

// Private bucket access is server-only. No public ACLs or download tokens are issued here.
export function getPrivateEmploymentBucket() {
  return getStorage(adminApp).bucket(storageBucket);
}
