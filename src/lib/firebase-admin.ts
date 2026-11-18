import fs from 'node:fs';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const firebaseConfig = JSON.parse(
  fs.readFileSync(new URL('../../firebase-applet-config.json', import.meta.url), 'utf8')
) as { projectId: string };

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(adminApp);
