// ============================================================================
// FIREBASE CONFIG — popuni ovo svojim podacima iz Firebase Console
// (Project settings → General → Your apps → SDK setup and configuration)
// ============================================================================
export const firebaseConfig = {
  apiKey: "UNESI_SVOJ_API_KEY",
  authDomain: "UNESI_SVOJ_PROJEKAT.firebaseapp.com",
  projectId: "UNESI_SVOJ_PROJEKAT_ID",
  storageBucket: "UNESI_SVOJ_PROJEKAT.appspot.com",
  messagingSenderId: "UNESI_SENDER_ID",
  appId: "UNESI_APP_ID",
};

// Napomena:
// 1) U Firebase Console uključi Authentication → Email/Password
// 2) Napravi Firestore bazu (Native mode)
// 3) Uključi Storage (za priloge/fotografije/račune)
// 4) Postavi pravila iz firestore.rules i storage.rules (Firestore/Storage → Rules)
// 5) Ovaj sistem je čist HTML/CSS/JS bez build alata — radi direktno u browseru
//    preko ES modula i CDN importa Firebase SDK-a (vidi firebase-init.js)
