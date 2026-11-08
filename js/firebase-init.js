// ============================================================================
// FIREBASE INIT — inicijalizacija preko CDN-a (bez build alata / npm-a)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, increment, writeBatch, Timestamp, collectionGroup,
  runTransaction, startAfter, getCountFromServer, getAggregateFromServer, average,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// Namespace import: opcioni "appCheckSiteKey" ne mora da postoji u firebase-config.js
import * as cfg from "./firebase-config.js";
const firebaseConfig = cfg.firebaseConfig;

export const app = initializeApp(firebaseConfig);

// App Check (opciono, besplatno): ako u firebase-config.js dodaš
//   export const appCheckSiteKey = "TVOJ_RECAPTCHA_V3_SITE_KEY";
// svaki zahtev ka Firestore/Storage nosi token koji dokazuje da dolazi iz tvoje
// aplikacije (vidi docs/MASTER-ADMIN-I-BEZBEDNOST.md). Bez ključa se ništa ne menja.
if (cfg.appCheckSiteKey) {
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js");
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(cfg.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  } catch (e) {
    console.error("App Check nije inicijalizovan:", e);
  }
}
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, updatePassword,
  reauthenticateWithCredential, EmailAuthProvider,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, increment,
  writeBatch, Timestamp, collectionGroup, runTransaction, startAfter, getCountFromServer, getAggregateFromServer, average,
  ref, uploadBytes, getDownloadURL, deleteObject,
};
