import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { environment } from 'src/environments/environment';

export function firebaseApp() {
  if (getApps().length) {
    return getApp();
  }
  return initializeApp(environment.firebaseConfig);
}

export function firebaseAuth() {
  return getAuth(firebaseApp());
}

export function firebaseDb() {
  return getFirestore(firebaseApp());
}

export function firebaseFunctions() {
  return getFunctions(firebaseApp(), 'us-central1');
}
