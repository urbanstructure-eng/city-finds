import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const isPlaceholder = (val: string) => !val || val.includes('TODO') || val.includes('KEYHERE');

if (isPlaceholder(firebaseConfig.apiKey) || isPlaceholder(firebaseConfig.projectId)) {
  console.warn('Firebase configuration contains placeholders. Please set up Firebase in AI Studio.');
}

let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  console.error('Failed to initialize Firebase:', error);
  // Create a dummy app object to prevent crashes on export
  app = { name: '[DEFAULT]' } as any;
}

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);
