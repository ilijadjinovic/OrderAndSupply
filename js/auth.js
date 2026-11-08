// ============================================================================
// AUTH — prijava, registracija firme, čuvar ruta po ulogama (Poglavlje 2)
// ============================================================================
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  doc, getDoc, updateDoc, serverTimestamp, writeBatch,
} from "./firebase-init.js";
import { ROLES, uid } from "./utils.js";
import { logAudit } from "./audit.js";

let cachedProfile = null;

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

// Registruje novu firmu + Admin firme nalog (Poglavlje 2.2)
// Firma, korisnik i usersIndex nastaju u JEDNOM batch-u: firestore.rules dozvoljava
// samoregistraciju samo ako u istoj grupi nastaje firma čiji je korisnik kreator
// (createdByUid) — tako niko ne može sebi da upiše tuđu firmu ni ulogu master_admin.
export async function registerCompany({ companyName, pib, mb, address, phone, email,
  currency = "RSD", language = "sr", timezone = "Europe/Belgrade", adminName, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: adminName });

  const companyId = uid("company");
  const batch = writeBatch(db);
  batch.set(doc(db, "companies", companyId), {
    companyId, name: companyName, pib, mb, address, phone, email,
    currency, language, timezone, logoUrl: "", workingHours: "",
    assignmentMode: "admin_bira", gpsTrackingEnabled: false,
    status: "active", createdByUid: cred.user.uid, createdAt: serverTimestamp(),
  });
  batch.set(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid, companyId, name: adminName, email,
    role: ROLES.ADMIN, active: true, createdAt: serverTimestamp(),
  });
  // Admin firme je i u usersIndex (ranije je nedostajao u listi korisnika firme)
  batch.set(doc(db, "companies", companyId, "usersIndex", cred.user.uid), {
    uid: cred.user.uid, name: adminName, email,
    role: ROLES.ADMIN, active: true, createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    // Ništa nije upisano — ukloni upravo napravljen Auth nalog da email ne ostane "zauzet"
    try { await cred.user.delete(); } catch { /* ignoriši */ }
    throw err;
  }

  await logAudit(companyId, { action: "company_registered", entity: "Company", entityId: companyId, actorName: adminName });
  return { companyId, uid: cred.user.uid };
}

export async function getUserProfile(uidValue) {
  if (cachedProfile && cachedProfile.uid === uidValue) return cachedProfile;
  const snap = await getDoc(doc(db, "users", uidValue));
  if (!snap.exists()) return null;
  cachedProfile = snap.data();
  return cachedProfile;
}

export function clearProfileCache() { cachedProfile = null; }

// Izmena imena ulogovanog korisnika — ažurira Firebase Auth displayName,
// glavni users/{uid} dokument i, ako korisnik pripada firmi, njen usersIndex
// dokument (koristi se za listanje korisnika u admin panelu).
export async function updateOwnName(user, companyId, newName) {
  await updateProfile(user, { displayName: newName });
  const updates = [updateDoc(doc(db, "users", user.uid), { name: newName })];
  if (companyId) {
    updates.push(updateDoc(doc(db, "companies", companyId, "usersIndex", user.uid), { name: newName }));
  }
  await Promise.all(updates);
  if (cachedProfile && cachedProfile.uid === user.uid) cachedProfile.name = newName;
}

// Izmena lozinke ulogovanog korisnika. Firebase iz bezbednosnih razloga
// zahteva "svežu" prijavu za osetljive operacije, pa se prvo radi
// reautentifikacija sa trenutnom lozinkom.
export async function changeOwnPassword(user, currentPassword, newPassword) {
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// ---------------------------------------------------------------------------
// STATUS FIRME — blokirana/obrisana firma ne sme da radi u aplikaciji.
// Rezultat: "ok" | "blocked" | "deleted". Pravila (firestore.rules) to i dalje
// primoravaju na serveru; ovo služi da korisnik dobije jasnu poruku umesto grešaka.
// Rezultat se kratko kešira u sessionStorage (da ne troši čitanje na svakoj strani).
// ---------------------------------------------------------------------------
const ACCESS_CACHE_MS = 5 * 60 * 1000;

export async function getCompanyAccessState(profile, { force = false } = {}) {
  if (!profile || !profile.companyId || profile.role === ROLES.MASTER_ADMIN) return "ok";
  const key = `companyAccess_${profile.companyId}`;
  try {
    if (!force) {
      const cached = JSON.parse(sessionStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.ts < ACCESS_CACHE_MS) return cached.state;
    }
  } catch { /* nevažeći keš — ignoriši */ }

  let state = "ok";
  try {
    const snap = await getDoc(doc(db, "companies", profile.companyId));
    if (!snap.exists()) state = "deleted";
    else {
      const st = snap.data().status;
      state = st === "blocked" || st === "deleted" ? st : "ok";
    }
  } catch (e) {
    console.error("Provera statusa firme nije uspela:", e);
    return "ok"; // pravila na serveru ionako štite podatke
  }
  try { sessionStorage.setItem(key, JSON.stringify({ state, ts: Date.now() })); } catch { /* ignoriši */ }
  return state;
}

// Beleži vreme poslednje aktivnosti (najviše jednom u 30 min po uređaju) —
// prikazuje se master adminu u pregledu korisnika firme.
const LAST_SEEN_THROTTLE_MS = 30 * 60 * 1000;

function touchLastSeen(user, profile) {
  try {
    const k = `lastSeen_${user.uid}`;
    if (Date.now() - Number(localStorage.getItem(k) || 0) < LAST_SEEN_THROTTLE_MS) return;
    localStorage.setItem(k, String(Date.now()));
    updateDoc(doc(db, "users", user.uid), { lastSeenAt: serverTimestamp() }).catch(() => {});
    if (profile.companyId) {
      updateDoc(doc(db, "companies", profile.companyId, "usersIndex", user.uid), { lastSeenAt: serverTimestamp() }).catch(() => {});
    }
  } catch { /* nije kritično */ }
}

// Čuva rutu: poziva callback(user, profile) kad je auth spreman;
// ako allowedRoles je zadat, preusmerava neautorizovane korisnike na odgovarajuću stranu;
// deaktiviran nalog i blokirana/obrisana firma odjavljuju korisnika uz poruku na prijavi.
export function requireAuth(allowedRoles, onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "./index.html";
      return;
    }
    const profile = await getUserProfile(user.uid);
    if (!profile) {
      await signOut(auth);
      window.location.href = "./index.html";
      return;
    }
    if (profile.active === false) {
      await signOut(auth);
      window.location.href = "./index.html?reason=deactivated";
      return;
    }
    if (allowedRoles && !allowedRoles.includes(profile.role)) {
      window.location.href = redirectForRole(profile.role);
      return;
    }
    const access = await getCompanyAccessState(profile);
    if (access !== "ok") {
      await signOut(auth);
      window.location.href = `./index.html?reason=${access}`;
      return;
    }
    onReady(user, profile);
    touchLastSeen(user, profile);
  });
}

export function redirectForRole(role) {
  switch (role) {
    case ROLES.MASTER_ADMIN: return "./master-admin.html";
    case ROLES.ADMIN: return "./admin-dashboard.html";
    case ROLES.NARUCILAC: return "./narucilac-dashboard.html";
    case ROLES.ISPORUCILAC: return "./isporucilac-dashboard.html";
    default: return "./index.html";
  }
}
