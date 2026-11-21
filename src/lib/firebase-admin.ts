import fs from 'node:fs';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const firebaseConfig = JSON.parse(
  fs.readFileSync(new URL('../../firebase-applet-config.json', import.meta.url), 'utf8')
) as { projectId: string; storageBucket?: string };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(adminApp);

// Private bucket access is server-only. No public ACLs or download tokens are issued here.
export function getPrivateEmploymentBucket() {
  const bucketName = firebaseConfig.storageBucket;
  if (!bucketName) throw new Error('Firebase Storage bucket is not configured');
  return getStorage(adminApp).bucket(bucketName);
}
