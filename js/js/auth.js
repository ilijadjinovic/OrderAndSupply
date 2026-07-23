// ============================================================================
// AUTH — prijava, registracija firme, čuvar ruta po ulogama (Poglavlje 2)
// ============================================================================
import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, doc, getDoc, setDoc, serverTimestamp,
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
export async function registerCompany({ companyName, pib, mb, address, phone, email,
  currency = "RSD", language = "sr", timezone = "Europe/Belgrade", adminName, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: adminName });

  const companyId = uid("company");
  await setDoc(doc(db, "companies", companyId), {
    companyId, name: companyName, pib, mb, address, phone, email,
    currency, language, timezone, logoUrl: "", workingHours: "",
    assignmentMode: "admin_bira", gpsTrackingEnabled: false,
    status: "active", createdAt: serverTimestamp(),
  });

  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid, companyId, name: adminName, email,
    role: ROLES.ADMIN, active: true, createdAt: serverTimestamp(),
  });

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

// Čuva rutu: poziva callback(user, profile) kad je auth spreman;
// ako allowedRoles je zadat, preusmerava neautorizovane korisnike na index.html
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
    if (allowedRoles && !allowedRoles.includes(profile.role)) {
      window.location.href = redirectForRole(profile.role);
      return;
    }
    onReady(user, profile);
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
