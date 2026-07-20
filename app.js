// ==========================================================================
// 1. FIREBASE INITIALIZATION & IMPORTS
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where, updateDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCQzACNpvwUztab2kExKvKVct92eH2Ekxs",
  authDomain: "reservation-system-b6f7d.firebaseapp.com",
  projectId: "reservation-system-b6f7d",
  storageBucket: "reservation-system-b6f7d.firebasestorage.app",
  messagingSenderId: "169143178876",
  appId: "1:169143178876:web:825b366e9b14baaec89bf9",
  measurementId: "G-NB9JSN35WL"
};

let app, db, auth;
let useFirebase = false;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  useFirebase = true;
} catch (e) {
  console.warn("Firebase initialization warning, falling back to local simulation:", e);
}

// ==========================================================================
// 2. STATE MANAGEMENT
// ==========================================================================
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user')) || null,
  currentDate: new Date(), // Active date for calendar view
  currentView: 'week', // 'week' | 'day'
  activeFieldMode: 'main', // 'main' | 'training'
  activeFieldFilters: new Set(),
  fields: [],
  users: [],
  reservations: [],
  fieldsMap: {}
};

// Calendar Time Window Limits
const START_HOUR = 8;
const END_HOUR = 21; // Last hour slot is 20:30 - 21:00
const SLOT_HEIGHT = 42; // px per 30 minutes, matches CSS --slot-height

// Drag Selection State
let isDragging = false;
let dragStartColIdx = null;
let dragStartSlotIdx = null;

// ==========================================================================
// 3. UTILITY FUNCTIONS
// ==========================================================================
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDateISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(date) {
  const days = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
  const dayName = days[date.getDay()];
  return `${dayName} ${date.getDate()}.${date.getMonth() + 1}.`;
}

function generateTimeSlots() {
  const slots = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    const hh = String(h).padStart(2, '0');
    slots.push(`${hh}:00`);
    slots.push(`${hh}:30`);
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

// Pure JS SHA-256 fallback
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const msgBytes = [];
  for (let i = 0; i < ascii.length; i++) {
    msgBytes.push(ascii.charCodeAt(i) & 0xff);
  }
  const msgLenBits = msgBytes.length * 8;
  msgBytes.push(0x80);
  while ((msgBytes.length + 8) % 64 !== 0) {
    msgBytes.push(0x00);
  }
  const highBits = Math.floor(msgLenBits / 0x100000000);
  const lowBits = msgLenBits & 0xffffffff;
  msgBytes.push((highBits >>> 24) & 0xff);
  msgBytes.push((highBits >>> 16) & 0xff);
  msgBytes.push((highBits >>> 8) & 0xff);
  msgBytes.push(highBits & 0xff);
  msgBytes.push((lowBits >>> 24) & 0xff);
  msgBytes.push((lowBits >>> 16) & 0xff);
  msgBytes.push((lowBits >>> 8) & 0xff);
  msgBytes.push(lowBits & 0xff);

  const hState = [...h];
  for (let chunkOffset = 0; chunkOffset < msgBytes.length; chunkOffset += 64) {
    const w = new Array(64).fill(0);
    for (let i = 0; i < 16; i++) {
      const p = chunkOffset + i * 4;
      w[i] = (msgBytes[p] << 24) | (msgBytes[p + 1] << 16) | (msgBytes[p + 2] << 8) | msgBytes[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const w2 = w[i - 2];
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = hState;
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + k[i] + w[i]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hState[0] = (hState[0] + a) | 0;
    hState[1] = (hState[1] + b) | 0;
    hState[2] = (hState[2] + c) | 0;
    hState[3] = (hState[3] + d) | 0;
    hState[4] = (hState[4] + e) | 0;
    hState[5] = (hState[5] + f) | 0;
    hState[6] = (hState[6] + g) | 0;
    hState[7] = (hState[7] + hh) | 0;
  }
  return hState.map(val => (val >>> 0).toString(16).padStart(8, '0')).join('');
}

// Hierarchical Field Conflict Logic
function areFieldsConflicting(fieldId1, fieldId2) {
  if (fieldId1 === fieldId2) return true;
  if (!state.fieldsMap[fieldId1] || !state.fieldsMap[fieldId2]) return false;

  let current = state.fieldsMap[fieldId2];
  while (current && current.parent_id) {
    if (current.parent_id === fieldId1) return true;
    current = state.fieldsMap[current.parent_id];
  }

  current = state.fieldsMap[fieldId1];
  while (current && current.parent_id) {
    if (current.parent_id === fieldId2) return true;
    current = state.fieldsMap[current.parent_id];
  }

  return false;
}

function areTimesOverlapping(start1, end1, start2, end2) {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();
  return s1 < e2 && e1 > s2;
}

// ==========================================================================
// 4. TOAST NOTIFICATIONS ENGINE
// ==========================================================================
function showToast(title, message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = '🔔';
  if (type === 'success') icon = '✅';
  else if (type === 'error') icon = '⚠️';
  else if (type === 'info') icon = 'ℹ️';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  const autoRemoveTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 5000);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(autoRemoveTimer);
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  });
}

// ==========================================================================
// 5. DEFAULT DATA & LOCAL STORAGE FALLBACK ENGINE
// ==========================================================================
const DEFAULT_FIELDS = [
  { id: "training_full", name: "Celé tréningové ihrisko", parent_id: null },
  { id: "training_half_a", name: "Trén. Polovica A", parent_id: "training_full" },
  { id: "training_half_b", name: "Trén. Polovica B", parent_id: "training_full" },
  { id: "training_quarter_a1", name: "Trén. Štvrtina A1", parent_id: "training_half_a" },
  { id: "training_quarter_a2", name: "Trén. Štvrtina A2", parent_id: "training_half_a" },
  { id: "training_quarter_b1", name: "Trén. Štvrtina B1", parent_id: "training_half_b" },
  { id: "training_quarter_b2", name: "Trén. Štvrtina B2", parent_id: "training_half_b" },
  { id: "main_full", name: "Celé hlavné ihrisko", parent_id: null },
  { id: "main_half_a", name: "Polovica A", parent_id: "main_full" },
  { id: "main_half_b", name: "Polovica B", parent_id: "main_full" },
  { id: "main_quarter_a1", name: "Štvrtina A1", parent_id: "main_half_a" },
  { id: "main_quarter_a2", name: "Štvrtina A2", parent_id: "main_half_a" },
  { id: "main_quarter_b1", name: "Štvrtina B1", parent_id: "main_half_b" },
  { id: "main_quarter_b2", name: "Štvrtina B2", parent_id: "main_half_b" }
];

const DEFAULT_USERS = [
  {
    id: "u-admin",
    name: "Administrátor",
    email: "admin@fc.sk",
    password: "admin123",
    role: "admin",
    color: "#ef4444"
  },
  {
    id: "u-u19",
    name: "Tréner U19",
    email: "u19@fc.sk",
    password: "u19pwd",
    role: "coach",
    color: "#3b82f6"
  },
  {
    id: "u-u15",
    name: "Tréner U15",
    email: "u15@fc.sk",
    password: "u15pwd",
    role: "coach",
    color: "#10b981"
  }
];

const MOCK_STORAGE_KEY = 'fc_reservation_db';

function getLocalDB() {
  let dbStr = localStorage.getItem(MOCK_STORAGE_KEY);
  if (!dbStr) {
    const initialDb = { users: DEFAULT_USERS, fields: DEFAULT_FIELDS, reservations: [] };
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(initialDb));
    return initialDb;
  }
  const localDb = JSON.parse(dbStr);
  if (!localDb.fields || localDb.fields.length < 14) {
    localDb.fields = DEFAULT_FIELDS;
  }
  if (!localDb.users || localDb.users.length === 0) {
    localDb.users = DEFAULT_USERS;
  }
  saveLocalDB(localDb);
  return localDb;
}

function saveLocalDB(dbData) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(dbData));
}

// ==========================================================================
// 6. API CLIENT (FIRESTORE REAL-TIME SYNC + FALLBACK)
// ==========================================================================
async function apiRequest(endpoint, options = {}) {
  const method = options.method || 'GET';

  // 1. FIELDS API
  if (endpoint.startsWith('/fields')) {
    if (useFirebase) {
      try {
        const querySnapshot = await getDocs(collection(db, "fields"));
        if (!querySnapshot.empty) {
          const firestoreFields = [];
          querySnapshot.forEach(doc => firestoreFields.push({ id: doc.id, ...doc.data() }));
          return firestoreFields;
        }
      } catch (err) {
        console.warn("Firestore fields fetch failed, using defaults:", err);
      }
    }
    return DEFAULT_FIELDS;
  }

  // 2. RESERVATIONS API
  if (endpoint.startsWith('/reservations')) {
    const parts = endpoint.split('?')[0].split('/').filter(Boolean);
    const resId = parts[1];

    // GET /reservations
    if (method === 'GET' && !resId) {
      const urlObj = new URL(endpoint, 'http://localhost');
      const startParam = urlObj.searchParams.get('start');
      const endParam = urlObj.searchParams.get('end');

      let list = [];
      if (useFirebase) {
        try {
          const querySnapshot = await getDocs(collection(db, "reservations"));
          querySnapshot.forEach(doc => {
            const data = doc.data();
            list.push({ id: doc.id, ...data });
          });
        } catch (err) {
          console.warn("Firestore reservations fetch error, fallback to local:", err);
          list = getLocalDB().reservations;
        }
      } else {
        list = getLocalDB().reservations;
      }

      if (startParam && endParam) {
        const s = new Date(startParam).getTime();
        const e = new Date(endParam).getTime();
        list = list.filter(r => {
          const rs = new Date(r.start_time).getTime();
          const re = new Date(r.end_time).getTime();
          return rs < e && re > s;
        });
      }

      const allUsers = state.users.length > 0 ? state.users : getLocalDB().users;
      return list.map(r => {
        const foundUser = allUsers.find(u => u.id === r.user_id) || (state.user && state.user.id === r.user_id ? state.user : null);
        return {
          ...r,
          user_name: r.user_name || (foundUser ? foundUser.name : 'Neznámy tréner'),
          user_color: r.user_color || (foundUser ? foundUser.color : '#3b82f6')
        };
      });
    }

    // POST /reservations
    if (method === 'POST' && !resId) {
      const body = options.body || {};
      const { field_id, start_time, end_time, user_id, event_type, opponent, note } = body;
      
      const targetUserId = user_id || (state.user ? state.user.id : 'u-u19');
      const targetUser = (state.users && state.users.find(u => u.id === targetUserId)) || state.user || { name: 'Tréner', color: '#3b82f6' };

      // Client-side Conflict Check
      const existingReservations = await apiRequest('/reservations');
      for (const r of existingReservations) {
        if (areTimesOverlapping(start_time, end_time, r.start_time, r.end_time)) {
          if (areFieldsConflicting(field_id, r.field_id)) {
            const conflictField = state.fieldsMap[r.field_id] ? state.fieldsMap[r.field_id].name : r.field_id;
            throw new Error(`Konflikt: ${r.user_name} už má v tomto čase rezervovanú plochu '${conflictField}'.`);
          }
        }
      }

      const newRes = {
        user_id: targetUserId,
        user_name: targetUser.name,
        user_color: targetUser.color || '#3b82f6',
        field_id,
        start_time: new Date(start_time).toISOString(),
        end_time: new Date(end_time).toISOString(),
        event_type: event_type || 'training',
        opponent: opponent || '',
        note: note || '',
        created_at: new Date().toISOString()
      };

      if (useFirebase) {
        try {
          const docRef = await addDoc(collection(db, "reservations"), newRes);
          return { id: docRef.id, ...newRes };
        } catch (err) {
          console.warn("Firestore addDoc failed, fallback to local:", err);
        }
      }

      const localDb = getLocalDB();
      const localRes = { id: 'r-' + Math.random().toString(36).substring(2, 11), ...newRes };
      localDb.reservations.push(localRes);
      saveLocalDB(localDb);
      return localRes;
    }

    // PUT /reservations/:id
    if (method === 'PUT' && resId) {
      const body = options.body || {};
      const { field_id, start_time, end_time, user_id, event_type, opponent, note } = body;

      const existingReservations = await apiRequest('/reservations');
      for (const r of existingReservations) {
        if (r.id === resId) continue;
        if (areTimesOverlapping(start_time, end_time, r.start_time, r.end_time)) {
          if (areFieldsConflicting(field_id, r.field_id)) {
            const conflictField = state.fieldsMap[r.field_id] ? state.fieldsMap[r.field_id].name : r.field_id;
            throw new Error(`Konflikt: ${r.user_name} už má v tomto čase rezervovanú plochu '${conflictField}'.`);
          }
        }
      }

      const updateData = {
        field_id,
        start_time: new Date(start_time).toISOString(),
        end_time: new Date(end_time).toISOString(),
        event_type: event_type || 'training',
        opponent: opponent || '',
        note: note || ''
      };

      if (user_id) {
        updateData.user_id = user_id;
        const targetUser = state.users.find(u => u.id === user_id);
        if (targetUser) {
          updateData.user_name = targetUser.name;
          updateData.user_color = targetUser.color;
        }
      }

      if (useFirebase) {
        try {
          await updateDoc(doc(db, "reservations", resId), updateData);
          return { id: resId, ...updateData };
        } catch (err) {
          console.warn("Firestore updateDoc failed, fallback to local:", err);
        }
      }

      const localDb = getLocalDB();
      const idx = localDb.reservations.findIndex(r => r.id === resId);
      if (idx !== -1) {
        localDb.reservations[idx] = { ...localDb.reservations[idx], ...updateData };
        saveLocalDB(localDb);
      }
      return { id: resId, ...updateData };
    }

    // DELETE /reservations/:id
    if (method === 'DELETE' && resId) {
      if (useFirebase) {
        try {
          await deleteDoc(doc(db, "reservations", resId));
          return { success: true };
        } catch (err) {
          console.warn("Firestore deleteDoc failed, fallback to local:", err);
        }
      }
      const localDb = getLocalDB();
      localDb.reservations = localDb.reservations.filter(r => r.id !== resId);
      saveLocalDB(localDb);
      return { success: true };
    }
  }

  // 3. USERS API (PERSISTED IN FIRESTORE & LOCAL STORAGE)
  if (endpoint.startsWith('/users')) {
    const parts = endpoint.split('?')[0].split('/').filter(Boolean);
    const userId = parts[1];

    // GET /users
    if (method === 'GET' && !userId) {
      let usersList = [];
      if (useFirebase) {
        try {
          const querySnapshot = await getDocs(collection(db, "users"));
          if (!querySnapshot.empty) {
            querySnapshot.forEach(docSnap => {
              usersList.push({ id: docSnap.id, ...docSnap.data() });
            });
            const localDb = getLocalDB();
            localDb.users = usersList;
            saveLocalDB(localDb);
            return usersList;
          } else {
            for (const u of DEFAULT_USERS) {
              await setDoc(doc(db, "users", u.id), u);
            }
            return DEFAULT_USERS;
          }
        } catch (err) {
          console.warn("Firestore users fetch error, fallback to local DB:", err);
        }
      }
      const localDb = getLocalDB();
      return localDb.users || DEFAULT_USERS;
    }

    // POST /users (Create User)
    if (method === 'POST' && !userId) {
      const { name, email, password, role, color } = options.body || {};
      const currentUsers = await apiRequest('/users');

      if (currentUsers.some(u => u.name.toLowerCase() === name.toLowerCase())) {
        throw new Error('Používateľ s týmto názvom kategórie už existuje.');
      }

      const newUser = {
        id: 'u-' + Math.random().toString(36).substring(2, 11),
        name,
        email: email ? email.toLowerCase() : `${name.toLowerCase().replace(/\s+/g, '')}@fc.sk`,
        password: password || 'password123',
        role: role || 'coach',
        color: color || '#8b5cf6'
      };

      if (useFirebase) {
        try {
          await setDoc(doc(db, "users", newUser.id), newUser);
        } catch (err) {
          console.warn("Firestore user create warning:", err);
        }
      }

      const localDb = getLocalDB();
      localDb.users.push(newUser);
      saveLocalDB(localDb);
      return newUser;
    }

    // PUT /users/:id (Edit User)
    if (method === 'PUT' && userId) {
      const { name, email, password, role, color } = options.body || {};
      const updateData = { name, email, password, role, color };

      if (useFirebase) {
        try {
          await setDoc(doc(db, "users", userId), updateData, { merge: true });
        } catch (err) {
          console.warn("Firestore user update warning:", err);
        }
      }

      const localDb = getLocalDB();
      const idx = localDb.users.findIndex(u => u.id === userId);
      if (idx !== -1) {
        localDb.users[idx] = { ...localDb.users[idx], ...updateData };
        saveLocalDB(localDb);
      }

      if (state.user && state.user.id === userId) {
        state.user = { ...state.user, name, email, role, color };
        localStorage.setItem('user', JSON.stringify(state.user));
      }

      return { id: userId, ...updateData };
    }

    // DELETE /users/:id
    if (method === 'DELETE' && userId) {
      if (useFirebase) {
        try {
          await deleteDoc(doc(db, "users", userId));
        } catch (err) {
          console.warn("Firestore user delete warning:", err);
        }
      }
      const localDb = getLocalDB();
      localDb.users = localDb.users.filter(u => u.id !== userId);
      localDb.reservations = localDb.reservations.filter(r => r.user_id !== userId);
      saveLocalDB(localDb);
      return { success: true };
    }
  }

  return [];
}

// ==========================================================================
// 7. AUTH FLOW & SESSION MANAGEMENT
// ==========================================================================
async function handleLogin(e) {
  e.preventDefault();
  let emailOrUsername = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!emailOrUsername.includes('@')) {
    emailOrUsername = `${emailOrUsername.toLowerCase()}@fc.sk`;
  }

  if (useFirebase) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, emailOrUsername, password);
      const user = userCredential.user;

      state.token = await user.getIdToken();
      state.user = {
        id: user.uid,
        name: user.email.split('@')[0],
        email: user.email,
        role: user.email.includes('admin') ? 'admin' : 'coach',
        color: user.email.includes('admin') ? '#ef4444' : '#3b82f6'
      };

      localStorage.setItem('token', state.token);
      localStorage.setItem('user', JSON.stringify(state.user));

      showToast('Prihlásenie úspešné', `Vitajte, ${state.user.name}!`);
      initDashboard();
      return;
    } catch (err) {
      console.warn("Firebase Auth failed, checking local & Firestore DB:", err);
    }
  }

  // Fallback Matching against DB user accounts
  const allUsers = await apiRequest('/users');
  const foundUser = allUsers.find(u => 
    (u.email && u.email.toLowerCase() === emailOrUsername.toLowerCase()) ||
    (u.name && u.name.toLowerCase() === emailOrUsername.split('@')[0].toLowerCase())
  );

  const isPasswordCorrect = foundUser && (
    foundUser.password === password || 
    foundUser.password === sha256(password)
  );

  if (!foundUser || !isPasswordCorrect) {
    showToast('Chyba prihlásenia', 'Nesprávne prihlasovacie meno alebo heslo.', 'error');
    return;
  }

  state.token = 'simulated-token-' + Math.random().toString(36).substring(2);
  state.user = { id: foundUser.id, name: foundUser.name, email: foundUser.email, role: foundUser.role, color: foundUser.color };
  localStorage.setItem('token', state.token);
  localStorage.setItem('user', JSON.stringify(state.user));

  showToast('Prihlásenie úspešné', `Vitajte, ${state.user.name}!`);
  initDashboard();
}

async function handleLogout() {
  if (useFirebase) {
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Firebase logout warning:", e);
    }
  }
  
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  
  showLoginView();
  showToast('Odhlásené', 'Boli ste úspešne odhlásený.');
}

function checkSession() {
  if (useFirebase) {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.token = await user.getIdToken();
        state.user = {
          id: user.uid,
          name: user.email.split('@')[0],
          email: user.email,
          role: user.email.includes('admin') ? 'admin' : 'coach',
          color: user.email.includes('admin') ? '#ef4444' : '#3b82f6'
        };
        localStorage.setItem('token', state.token);
        localStorage.setItem('user', JSON.stringify(state.user));
        initDashboard();
      } else if (!state.token) {
        showLoginView();
      } else {
        initDashboard();
      }
    });
    return;
  }

  if (state.token && state.user) {
    initDashboard();
  } else {
    showLoginView();
  }
}

function showLoginView() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('dashboard-section').classList.add('hidden');
  const adminSec = document.getElementById('admin-section');
  if (adminSec) adminSec.classList.add('hidden');
}

// ==========================================================================
// 8. DASHBOARD & UI ENGINE
// ==========================================================================
async function initDashboard() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');

  if (state.user) {
    document.getElementById('user-display-name').textContent = state.user.name;
    document.getElementById('user-display-role').textContent = state.user.role === 'admin' ? 'Administrátor' : 'Tréner';
    
    const avatar = document.getElementById('user-avatar');
    avatar.textContent = state.user.name.charAt(0).toUpperCase();
    avatar.style.backgroundColor = state.user.color || '#4b5563';

    const adminToggleBtn = document.getElementById('admin-toggle-btn');
    if (state.user.role === 'admin') {
      adminToggleBtn.classList.remove('hidden');
      document.getElementById('res-user-select-group').classList.remove('hidden');
    } else {
      adminToggleBtn.classList.add('hidden');
      document.getElementById('res-user-select-group').classList.add('hidden');
    }
  }

  try {
    state.fields = await apiRequest('/fields');
    state.fieldsMap = {};
    state.fields.forEach(f => {
      state.fieldsMap[f.id] = f;
    });

    state.users = await apiRequest('/users');

    populateFieldsDropdowns();
    renderMiniPitchMap();
    
    if (state.user && state.user.role === 'admin') {
      loadAdminUsers();
    }

    await refreshCalendar();
  } catch (err) {
    showToast('Chyba inicializácie', 'Nepodarilo sa načítať dáta.', 'error');
  }
}

function populateFieldsDropdowns() {
  const resFieldSelect = document.getElementById('res-field-id');
  if (!resFieldSelect) return;
  resFieldSelect.innerHTML = '';
  
  state.fields.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    let prefix = '';
    if (f.parent_id === 'main_full' || f.parent_id === 'training_full') {
      prefix = ' ├─ ';
    } else if (f.parent_id && (f.parent_id.startsWith('main_half') || f.parent_id.startsWith('training_half'))) {
      prefix = '    ├─ ';
    }
    
    opt.textContent = prefix + f.name;
    resFieldSelect.appendChild(opt);
  });
}

function renderMiniPitchMap() {
  const miniCards = document.querySelectorAll('.modal-pitch-helper .mini-pitch-card, .modal-pitch-helper .mini-half, .modal-pitch-helper .mini-quarter');
  const selectElement = document.getElementById('res-field-id');
  if (!selectElement) return;

  function updateMiniMapSelection(selectedFieldId) {
    miniCards.forEach(c => {
      if (c.getAttribute('data-field-id') === selectedFieldId) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });
  }

  miniCards.forEach(card => {
    card.onclick = null;
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      const fieldId = card.getAttribute('data-field-id');
      selectElement.value = fieldId;
      updateMiniMapSelection(fieldId);
    });
  });

  selectElement.onchange = null;
  selectElement.addEventListener('change', () => {
    updateMiniMapSelection(selectElement.value);
  });
}

// ==========================================================================
// 9. CALENDAR RENDER ENGINE
// ==========================================================================
async function refreshCalendar() {
  const range = getCalendarDateRange();
  try {
    state.reservations = await apiRequest(`/reservations?start=${range.start.toISOString()}&end=${range.end.toISOString()}`);
    renderCalendarGrid();
    renderReservationsOverlay();
  } catch (err) {
    showToast('Chyba kalendára', 'Nepodarilo sa aktualizovať rezervácie.', 'error');
  }
}

function getCalendarDateRange() {
  if (state.currentView === 'day') {
    const start = new Date(state.currentDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(state.currentDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  } else {
    const start = getMonday(state.currentDate);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    end.setHours(0, 0, 0, 0);
    return { start, end };
  }
}

function getDaysOfCurrentView() {
  const days = [];
  if (state.currentView === 'day') {
    days.push(new Date(state.currentDate));
  } else {
    const monday = getMonday(state.currentDate);
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
  }
  return days;
}

function renderCalendarGrid() {
  const days = getDaysOfCurrentView();
  const numDays = days.length;
  const totalGridCols = numDays * 4;
  
  document.documentElement.style.setProperty('--num-columns', totalGridCols);
  
  const headerGrid = document.getElementById('calendar-header-grid');
  if (!headerGrid) return;
  headerGrid.innerHTML = '<div class="time-column-header"></div>';
  
  const todayStr = formatDateISO(new Date());

  // Row 1: Day headers spanning 4 columns
  days.forEach((day, dIdx) => {
    const isToday = formatDateISO(day) === todayStr;
    const dayHeader = document.createElement('div');
    dayHeader.className = `day-column-header-span ${isToday ? 'is-today' : ''}`;
    const startCol = 2 + dIdx * 4;
    dayHeader.style.gridColumn = `${startCol} / span 4`;
    
    dayHeader.innerHTML = `
      <div>
        <span style="font-size: 0.65rem; text-transform: uppercase; opacity: 0.75;">${formatDisplayDate(day).split(' ')[0]}</span>
        <span style="font-weight: 700; margin-left: 4px;">${day.getDate()}.${day.getMonth() + 1}.</span>
      </div>
    `;
    headerGrid.appendChild(dayHeader);
  });

  // Row 2: Sub-headers (A1, A2, B1, B2)
  const lanes = ['A1', 'A2', 'B1', 'B2'];
  for (let dIdx = 0; dIdx < numDays; dIdx++) {
    lanes.forEach((laneName, lIdx) => {
      const laneHeader = document.createElement('div');
      laneHeader.className = `lane-sub-header ${lIdx === 3 ? 'end-of-day' : ''}`;
      const colIdx = 2 + dIdx * 4 + lIdx;
      laneHeader.style.gridColumn = `${colIdx}`;
      laneHeader.textContent = laneName;
      headerGrid.appendChild(laneHeader);
    });
  }

  const title = document.getElementById('calendar-week-range');
  if (title) {
    if (state.currentView === 'day') {
      title.textContent = formatDisplayDate(state.currentDate) + ` ${state.currentDate.getFullYear()}`;
    } else {
      const monday = days[0];
      const sunday = days[6];
      title.textContent = `${monday.getDate()}. ${monday.getMonth() + 1}. – ${sunday.getDate()}. ${sunday.getMonth() + 1}. ${sunday.getFullYear()}`;
    }
  }

  // Render cells in body grid
  const bodyGrid = document.getElementById('calendar-body-grid');
  if (!bodyGrid) return;
  bodyGrid.innerHTML = '';
  
  TIME_SLOTS.forEach((timeStr, slotIdx) => {
    const isHourSlot = timeStr.endsWith(':00');
    
    // Axis time label
    const labelCell = document.createElement('div');
    labelCell.className = `time-label-cell ${isHourSlot ? 'hour-label' : ''}`;
    if (isHourSlot) {
      labelCell.innerHTML = `<span>${timeStr}</span>`;
    }
    bodyGrid.appendChild(labelCell);
    
    // Cells for columns
    for (let colIdx = 0; colIdx < totalGridCols; colIdx++) {
      const cell = document.createElement('div');
      cell.className = `calendar-cell ${isHourSlot ? 'hour-cell' : ''}`;
      
      const dayIdx = Math.floor(colIdx / 4);
      const laneIdx = colIdx % 4;
      
      let fieldId;
      if (state.activeFieldMode === 'training') {
        const laneFields = ['training_quarter_a1', 'training_quarter_a2', 'training_quarter_b1', 'training_quarter_b2'];
        fieldId = laneFields[laneIdx];
      } else {
        const laneFields = ['main_quarter_a1', 'main_quarter_a2', 'main_quarter_b1', 'main_quarter_b2'];
        fieldId = laneFields[laneIdx];
      }
      
      if (laneIdx === 3) {
        cell.classList.add('end-of-day');
      }
      
      cell.setAttribute('data-col-idx', colIdx);
      cell.setAttribute('data-day-idx', dayIdx);
      cell.setAttribute('data-lane-idx', laneIdx);
      cell.setAttribute('data-field-id', fieldId);
      cell.setAttribute('data-slot-idx', slotIdx);
      cell.setAttribute('data-time', timeStr);
      
      cell.addEventListener('mousedown', (e) => startDragSelection(e, colIdx, slotIdx));
      cell.addEventListener('mouseenter', () => handleDragEnter(colIdx, slotIdx));
      
      bodyGrid.appendChild(cell);
    }
  });

  window.onmouseup = null;
  window.addEventListener('mouseup', finalizeDragSelection);
}

function renderReservationsOverlay() {
  const overlay = document.getElementById('reservations-overlay');
  if (!overlay) return;
  overlay.innerHTML = '';

  const days = getDaysOfCurrentView();
  const numDays = days.length;
  const daysStrMap = days.map(d => formatDateISO(d));

  const totalGridCols = numDays * 4;
  const lanesPerDay = 4;

  const filteredReservations = state.reservations.filter(res => {
    const isTrainingRes = res.field_id && res.field_id.startsWith('training_');
    if (state.activeFieldMode === 'training') {
      return isTrainingRes;
    } else {
      return !isTrainingRes;
    }
  });

  filteredReservations.forEach(res => {
    const localStart = new Date(res.start_time);
    const localEnd = new Date(res.end_time);
    const dateStr = formatDateISO(localStart);
    
    const dayColumnIdx = daysStrMap.indexOf(dateStr);
    if (dayColumnIdx === -1) return;

    const startHour = localStart.getHours();
    const startMin = localStart.getMinutes();
    const endHour = localEnd.getHours();
    const endMin = localEnd.getMinutes();

    const calendarStartMins = START_HOUR * 60;
    const startMins = startHour * 60 + startMin - calendarStartMins;
    const endMins = endHour * 60 + endMin - calendarStartMins;

    const calendarHeightMins = (END_HOUR - START_HOUR) * 60;
    const clampedStartMins = Math.max(0, Math.min(calendarHeightMins, startMins));
    const clampedEndMins = Math.max(0, Math.min(calendarHeightMins, endMins));
    
    if (clampedStartMins >= clampedEndMins) return;

    const top = (clampedStartMins / 30) * SLOT_HEIGHT;
    const height = ((clampedEndMins - clampedStartMins) / 30) * SLOT_HEIGHT;

    let laneOffset = 0;
    let laneSpan = 1;

    const fieldId = res.field_id || '';
    if (fieldId.endsWith('_quarter_a1')) {
      laneOffset = 0; laneSpan = 1;
    } else if (fieldId.endsWith('_quarter_a2')) {
      laneOffset = 1; laneSpan = 1;
    } else if (fieldId.endsWith('_quarter_b1')) {
      laneOffset = 2; laneSpan = 1;
    } else if (fieldId.endsWith('_quarter_b2')) {
      laneOffset = 3; laneSpan = 1;
    } else if (fieldId.endsWith('_half_a')) {
      laneOffset = 0; laneSpan = 2;
    } else if (fieldId.endsWith('_half_b')) {
      laneOffset = 2; laneSpan = 2;
    } else if (fieldId.endsWith('_full')) {
      laneOffset = 0; laneSpan = 4;
    }

    const colStart = dayColumnIdx * lanesPerDay + laneOffset;
    const leftPercent = (colStart / totalGridCols) * 100;
    const widthPercent = (laneSpan / totalGridCols) * 100;

    const card = document.createElement('div');
    card.className = 'reservation-card';
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.left = `calc(${leftPercent}% + 2px)`;
    card.style.width = `calc(${widthPercent}% - 4px)`;
    
    const userColor = res.user_color || '#3b82f6';
    card.style.setProperty('--card-accent', userColor);
    card.style.backgroundColor = `${userColor}24`;

    const formatTimeStr = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fieldName = state.fieldsMap[res.field_id] ? state.fieldsMap[res.field_id].name : res.field_id;

    // Event Type Badging
    let eventTypeBadge = '';
    if (res.event_type === 'friendly_match') {
      eventTypeBadge = `<div class="res-card-event-type">⚽ Prípravný vs ${res.opponent || 'Súper'}</div>`;
    } else if (res.event_type === 'league_match') {
      eventTypeBadge = `<div class="res-card-event-type">⚽ Majstrovský vs ${res.opponent || 'Súper'}</div>`;
    } else if (res.event_type === 'tournament') {
      eventTypeBadge = `<div class="res-card-event-type">🏆 Turnaj</div>`;
    } else if (res.event_type === 'other') {
      eventTypeBadge = `<div class="res-card-event-type">ℹ️ ${res.note || 'Iné'}</div>`;
    } else {
      eventTypeBadge = `<div class="res-card-event-type">Tréning</div>`;
    }

    card.innerHTML = `
      <div class="res-card-header">
        <span class="res-card-coach" style="font-weight: 700;">${res.user_name}</span>
        <span class="res-card-time" style="font-size: 0.6rem;">${formatTimeStr(localStart)} - ${formatTimeStr(localEnd)}</span>
      </div>
      ${eventTypeBadge}
      <div class="res-card-field">${fieldName}</div>
    `;

    const isOwner = state.user && res.user_id === state.user.id;
    const isAdmin = state.user && state.user.role === 'admin';
    
    if (isAdmin || isOwner) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        openReservationModal(res);
      });
    } else {
      card.style.cursor = 'not-allowed';
      card.title = `Rezervácia tímu ${res.user_name}`;
    }

    overlay.appendChild(card);
  });
}

// ==========================================================================
// 10. DRAG & DROP / RANGE SELECTION
// ==========================================================================
function startDragSelection(e, colIdx, slotIdx) {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartColIdx = colIdx;
  dragStartSlotIdx = slotIdx;
  
  clearDragSelectionStyles();
  highlightCell(colIdx, slotIdx);
}

function handleDragEnter(colIdx, slotIdx) {
  if (!isDragging) return;
  if (colIdx !== dragStartColIdx) return;

  clearDragSelectionStyles();
  
  const minIdx = Math.min(dragStartSlotIdx, slotIdx);
  const maxIdx = Math.max(dragStartSlotIdx, slotIdx);

  for (let i = minIdx; i <= maxIdx; i++) {
    highlightCell(colIdx, i);
  }
}

function highlightCell(colIdx, slotIdx) {
  const cell = document.querySelector(`.calendar-cell[data-col-idx="${colIdx}"][data-slot-idx="${slotIdx}"]`);
  if (cell) {
    cell.classList.add('drag-selecting');
  }
}

function clearDragSelectionStyles() {
  document.querySelectorAll('.calendar-cell.drag-selecting').forEach(c => {
    c.classList.remove('drag-selecting');
  });
}

function finalizeDragSelection() {
  if (!isDragging) return;
  isDragging = false;

  const selectedCells = document.querySelectorAll('.calendar-cell.drag-selecting');
  if (selectedCells.length === 0) return;

  let minIdx = 9999;
  let maxIdx = -1;

  selectedCells.forEach(cell => {
    const sIdx = parseInt(cell.getAttribute('data-slot-idx'));
    if (sIdx < minIdx) minIdx = sIdx;
    if (sIdx > maxIdx) maxIdx = sIdx;
  });

  clearDragSelectionStyles();

  const firstCell = selectedCells[0];
  const dayIdx = parseInt(firstCell.getAttribute('data-day-idx'));
  const fieldId = firstCell.getAttribute('data-field-id');

  const days = getDaysOfCurrentView();
  const selectedDate = days[dayIdx];
  const startSlotStr = TIME_SLOTS[minIdx];
  
  let endSlotStr;
  if (maxIdx + 1 < TIME_SLOTS.length) {
    endSlotStr = TIME_SLOTS[maxIdx + 1];
  } else {
    endSlotStr = `${END_HOUR}:00`;
  }

  openReservationModal({
    start_time: combineDateAndTimeISO(selectedDate, startSlotStr),
    end_time: combineDateAndTimeISO(selectedDate, endSlotStr),
    field_id: fieldId
  });
}

function combineDateAndTimeISO(dateObj, timeStr) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${timeStr}:00`;
}

// ==========================================================================
// 11. RESERVATION MODAL CONTROLLER
// ==========================================================================
function updateEventTypeFields() {
  const typeSelect = document.getElementById('res-event-type');
  const opponentGroup = document.getElementById('res-opponent-group');
  const opponentInput = document.getElementById('res-opponent');
  const noteGroup = document.getElementById('res-note-group');
  const noteInput = document.getElementById('res-note');

  if (!typeSelect) return;
  const val = typeSelect.value;

  if (val === 'friendly_match' || val === 'league_match') {
    opponentGroup.classList.remove('hidden');
    opponentInput.required = true;
    noteGroup.classList.add('hidden');
    noteInput.required = false;
  } else if (val === 'other') {
    noteGroup.classList.remove('hidden');
    noteInput.required = true;
    opponentGroup.classList.add('hidden');
    opponentInput.required = false;
  } else {
    opponentGroup.classList.add('hidden');
    opponentInput.required = false;
    noteGroup.classList.add('hidden');
    noteInput.required = false;
  }
}

function openReservationModal(res = null) {
  const modal = document.getElementById('reservation-modal');
  const form = document.getElementById('reservation-form');
  const deleteBtn = document.getElementById('delete-res-btn');
  const title = document.getElementById('modal-title');
  if (!modal || !form) return;

  form.reset();
  populateTimeSelects();

  if (res && res.id) {
    title.textContent = 'Upraviť rezerváciu plochy';
    document.getElementById('res-id').value = res.id;
    document.getElementById('res-field-id').value = res.field_id;
    
    if (state.user && state.user.role === 'admin') {
      deleteBtn.classList.remove('hidden');
      document.getElementById('res-user-id').value = res.user_id;
    } else if (state.user && res.user_id === state.user.id) {
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }

    const localStart = new Date(res.start_time);
    const localEnd = new Date(res.end_time);
    
    document.getElementById('res-date').value = formatDateISO(localStart);
    document.getElementById('res-start-time').value = formatTimePadding(localStart);
    document.getElementById('res-end-time').value = formatTimePadding(localEnd);

    document.getElementById('res-event-type').value = res.event_type || 'training';
    document.getElementById('res-opponent').value = res.opponent || '';
    document.getElementById('res-note').value = res.note || '';
  } else {
    title.textContent = 'Nová rezervácia plochy';
    document.getElementById('res-id').value = '';
    deleteBtn.classList.add('hidden');

    if (state.user && state.user.role === 'admin') {
      document.getElementById('res-user-id').value = state.user.id;
    }

    const defaultFieldId = state.activeFieldMode === 'training' ? 'training_full' : 'main_full';
    if (res) {
      document.getElementById('res-field-id').value = res.field_id || defaultFieldId;
      const sDate = new Date(res.start_time);
      const eDate = new Date(res.end_time);
      document.getElementById('res-date').value = formatDateISO(sDate);
      document.getElementById('res-start-time').value = formatTimePadding(sDate);
      document.getElementById('res-end-time').value = formatTimePadding(eDate);
    } else {
      document.getElementById('res-field-id').value = defaultFieldId;
      document.getElementById('res-date').value = formatDateISO(state.currentDate);
      document.getElementById('res-start-time').value = '16:00';
      document.getElementById('res-end-time').value = '17:30';
    }

    document.getElementById('res-event-type').value = 'training';
    document.getElementById('res-opponent').value = '';
    document.getElementById('res-note').value = '';
  }

  updateEventTypeFields();

  const selectedFieldId = document.getElementById('res-field-id').value;
  document.querySelectorAll('.modal-pitch-helper .mini-pitch-card, .modal-pitch-helper .mini-half, .modal-pitch-helper .mini-quarter').forEach(c => {
    if (c.getAttribute('data-field-id') === selectedFieldId) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  modal.classList.remove('hidden');
}

function formatTimePadding(dateObj) {
  return `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
}

function populateTimeSelects() {
  const startSelect = document.getElementById('res-start-time');
  const endSelect = document.getElementById('res-end-time');
  if (!startSelect || !endSelect) return;

  startSelect.innerHTML = '';
  endSelect.innerHTML = '';

  TIME_SLOTS.forEach(time => {
    const opt = document.createElement('option');
    opt.value = time;
    opt.textContent = time;
    startSelect.appendChild(opt);
  });

  TIME_SLOTS.forEach(time => {
    const opt = document.createElement('option');
    opt.value = time;
    opt.textContent = time;
    endSelect.appendChild(opt);
  });
  const finalOpt = document.createElement('option');
  finalOpt.value = `${END_HOUR}:00`;
  finalOpt.textContent = `${END_HOUR}:00`;
  endSelect.appendChild(finalOpt);
}

async function saveReservation(e) {
  e.preventDefault();
  const id = document.getElementById('res-id').value;
  const fieldId = document.getElementById('res-field-id').value;
  const dateStr = document.getElementById('res-date').value;
  const startStr = document.getElementById('res-start-time').value;
  const endStr = document.getElementById('res-end-time').value;
  
  const eventType = document.getElementById('res-event-type').value;
  const opponent = document.getElementById('res-opponent').value.trim();
  const note = document.getElementById('res-note').value.trim();

  const startDate = new Date(`${dateStr}T${startStr}:00`);
  const endDate = new Date(`${dateStr}T${endStr}:00`);

  if (startDate.getTime() >= endDate.getTime()) {
    showToast('Neplatný časový rozsah', 'Koniec rezervácie musí byť neskôr ako začiatok.', 'error');
    return;
  }

  if ((eventType === 'friendly_match' || eventType === 'league_match') && !opponent) {
    showToast('Chýbajúce údaje', 'Pre zápas je povinné zadať názov súpera.', 'error');
    return;
  }

  if (eventType === 'other' && !note) {
    showToast('Chýbajúce údaje', 'Pre udalosť "Iné" je povinné zadať poznámku / popis.', 'error');
    return;
  }

  const payload = {
    field_id: fieldId,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString(),
    event_type: eventType,
    opponent,
    note
  };

  if (state.user && state.user.role === 'admin') {
    payload.user_id = document.getElementById('res-user-id').value;
  }

  try {
    if (id) {
      await apiRequest(`/reservations/${id}`, { method: 'PUT', body: payload });
      showToast('Rezervácia upravená', 'Zmeny boli úspešne uložené.');
    } else {
      await apiRequest('/reservations', { method: 'POST', body: payload });
      showToast('Rezervácia vytvorená', 'Ihrisko bolo úspešne zarezervované.');
    }

    closeModal();
    refreshCalendar();
  } catch (err) {
    showToast('Konflikt rezervácií', err.message, 'error');
  }
}

async function deleteReservation() {
  const id = document.getElementById('res-id').value;
  if (!id) return;
  if (!confirm('Naozaj chcete vymazať túto rezerváciu?')) return;

  try {
    await apiRequest(`/reservations/${id}`, { method: 'DELETE' });
    showToast('Rezervácia zmazaná', 'Rezervácia bola úspešne vymazaná.');
    closeModal();
    refreshCalendar();
  } catch (err) {
    showToast('Chyba mazania', err.message, 'error');
  }
}

function closeModal() {
  const modal = document.getElementById('reservation-modal');
  if (modal) modal.classList.add('hidden');
}

// ==========================================================================
// 12. ADMIN PAGE CONTROLLER (USER ACCOUNTS & EDIT MODAL)
// ==========================================================================
async function loadAdminUsers() {
  try {
    state.users = await apiRequest('/users');
    const userSelect = document.getElementById('res-user-id');
    if (userSelect) {
      userSelect.innerHTML = '';
      state.users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.name} (${u.role === 'admin' ? 'Admin' : 'Tréner'})`;
        userSelect.appendChild(opt);
      });
    }
    renderAdminUsersList();
  } catch (err) {
    console.error('Could not load users list for admin panel', err);
  }
}

function renderAdminUsersList() {
  const container = document.getElementById('users-list-container');
  if (!container) return;
  container.innerHTML = '';

  state.users.forEach(u => {
    const item = document.createElement('div');
    item.className = 'user-list-item';
    const isSelf = state.user && u.id === state.user.id;
    const pwdDisplay = u.password || '—';
    
    item.innerHTML = `
      <div class="user-list-info">
        <span class="user-color-dot" style="background-color: ${u.color || '#4b5563'}; width: 14px; height: 14px; border-radius: 50%;"></span>
        <div class="user-list-details">
          <div class="user-list-name">${u.name} <span class="user-list-role">${u.role === 'admin' ? 'Admin' : 'Tréner'}</span></div>
          <div class="user-list-meta">
            <span>${u.email || 'Bez e-mailu'}</span>
            <span class="user-password-badge">
              🔑 <span class="pwd-text" data-plain="${pwdDisplay}">••••••••</span>
              <button type="button" class="toggle-pwd-btn" title="Ukázať / Skryť heslo">👁️</button>
            </span>
          </div>
        </div>
      </div>
      <div class="user-item-actions">
        <button type="button" class="btn btn-secondary btn-xs edit-user-btn" data-user-id="${u.id}">✏️ Upraviť</button>
        ${isSelf ? '' : `<button type="button" class="btn btn-danger btn-link btn-xs delete-user-btn" data-user-id="${u.id}">&times; Zmazať</button>`}
      </div>
    `;

    // Toggle password view
    const toggleBtn = item.querySelector('.toggle-pwd-btn');
    const pwdText = item.querySelector('.pwd-text');
    toggleBtn.addEventListener('click', () => {
      if (pwdText.textContent === '••••••••') {
        pwdText.textContent = pwdText.getAttribute('data-plain');
      } else {
        pwdText.textContent = '••••••••';
      }
    });

    // Edit user button
    item.querySelector('.edit-user-btn').addEventListener('click', () => openEditUserModal(u));

    // Delete user button
    if (!isSelf) {
      item.querySelector('.delete-user-btn').addEventListener('click', () => deleteUserAccount(u.id, u.name));
    }

    container.appendChild(item);
  });
}

function openEditUserModal(userObj) {
  const modal = document.getElementById('edit-user-modal');
  if (!modal) return;

  document.getElementById('edit-user-id').value = userObj.id;
  document.getElementById('edit-user-name').value = userObj.name;
  document.getElementById('edit-user-email').value = userObj.email || '';
  document.getElementById('edit-user-password').value = userObj.password || '';
  document.getElementById('edit-user-role').value = userObj.role || 'coach';
  document.getElementById('edit-user-color').value = userObj.color || '#8b5cf6';

  modal.classList.remove('hidden');
}

function closeEditUserModal() {
  const modal = document.getElementById('edit-user-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleEditUserSubmit(e) {
  e.preventDefault();
  const userId = document.getElementById('edit-user-id').value;
  const name = document.getElementById('edit-user-name').value.trim();
  const email = document.getElementById('edit-user-email').value.trim();
  const password = document.getElementById('edit-user-password').value;
  const role = document.getElementById('edit-user-role').value;
  const color = document.getElementById('edit-user-color').value;

  try {
    await apiRequest(`/users/${userId}`, {
      method: 'PUT',
      body: { name, email, password, role, color }
    });
    
    showToast('Profil upravený', `Profil pre '${name}' bol úspešne upravený.`);
    closeEditUserModal();
    
    await loadAdminUsers();
    await refreshCalendar();
  } catch (err) {
    showToast('Chyba úpravy profilu', err.message, 'error');
  }
}

async function handleCreateUserAccount(e) {
  e.preventDefault();
  const name = document.getElementById('user-name').value.trim();
  const email = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  const color = document.getElementById('user-color').value;

  try {
    await apiRequest('/users', {
      method: 'POST',
      body: { name, email, password, role, color }
    });
    
    showToast('Profil vytvorený', `Profil pre '${name}' bol úspešne vytvorený.`);
    document.getElementById('create-user-form').reset();
    
    await loadAdminUsers();
    await refreshCalendar();
  } catch (err) {
    showToast('Chyba vytvorenia profilu', err.message, 'error');
  }
}

async function deleteUserAccount(userId, name) {
  if (!confirm(`Naozaj chcete vymazať profil trénera "${name}"? Všetky jeho rezervácie budú automaticky odstránené.`)) return;

  try {
    await apiRequest(`/users/${userId}`, { method: 'DELETE' });
    showToast('Profil vymazaný', `Profil trénera a všetky jeho rezervácie boli úspešne odstránené.`);
    
    await loadAdminUsers();
    await refreshCalendar();
  } catch (err) {
    showToast('Chyba vymazania profilu', err.message, 'error');
  }
}

// Section Toggles (Admin Full Page)
const dashboardSection = document.getElementById('dashboard-section');
const adminSection = document.getElementById('admin-section');

const adminToggleBtn = document.getElementById('admin-toggle-btn');
if (adminToggleBtn) {
  adminToggleBtn.addEventListener('click', () => {
    if (dashboardSection) dashboardSection.classList.add('hidden');
    if (adminSection) adminSection.classList.remove('hidden');
    loadAdminUsers();
  });
}

const adminBackBtn = document.getElementById('admin-back-btn');
if (adminBackBtn) {
  adminBackBtn.addEventListener('click', () => {
    if (adminSection) adminSection.classList.add('hidden');
    if (dashboardSection) dashboardSection.classList.remove('hidden');
  });
}

const createUserForm = document.getElementById('create-user-form');
if (createUserForm) {
  createUserForm.addEventListener('submit', handleCreateUserAccount);
}

const editUserForm = document.getElementById('edit-user-form');
if (editUserForm) {
  editUserForm.addEventListener('submit', handleEditUserSubmit);
}

const closeEditUserModalBtn = document.getElementById('close-edit-user-modal-btn');
if (closeEditUserModalBtn) closeEditUserModalBtn.addEventListener('click', closeEditUserModal);

const cancelEditUserBtn = document.getElementById('cancel-edit-user-btn');
if (cancelEditUserBtn) cancelEditUserBtn.addEventListener('click', closeEditUserModal);

// Modal Buttons
const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

const cancelResBtn = document.getElementById('cancel-res-btn');
if (cancelResBtn) cancelResBtn.addEventListener('click', closeModal);

const resForm = document.getElementById('reservation-form');
if (resForm) resForm.addEventListener('submit', saveReservation);

const deleteResBtn = document.getElementById('delete-res-btn');
if (deleteResBtn) deleteResBtn.addEventListener('click', deleteReservation);

// Event Type change listener
const resEventType = document.getElementById('res-event-type');
if (resEventType) {
  resEventType.addEventListener('change', updateEventTypeFields);
}

// Mobile FAB & Toggle listeners
const mobileFab = document.getElementById('mobile-add-res-btn');
if (mobileFab) {
  mobileFab.addEventListener('click', () => openReservationModal());
}

const togglePitchBtn = document.getElementById('toggle-pitch-img-btn');
if (togglePitchBtn) {
  togglePitchBtn.addEventListener('click', () => {
    const wrapper = document.getElementById('pitch-img-wrapper');
    if (wrapper) wrapper.classList.toggle('collapsed');
  });
}

// Navigation Controls
document.getElementById('prev-week-btn').addEventListener('click', () => {
  if (state.currentView === 'day') {
    state.currentDate.setDate(state.currentDate.getDate() - 1);
  } else {
    state.currentDate.setDate(state.currentDate.getDate() - 7);
  }
  refreshCalendar();
});

document.getElementById('next-week-btn').addEventListener('click', () => {
  if (state.currentView === 'day') {
    state.currentDate.setDate(state.currentDate.getDate() + 1);
  } else {
    state.currentDate.setDate(state.currentDate.getDate() + 7);
  }
  refreshCalendar();
});

document.getElementById('today-btn').addEventListener('click', () => {
  state.currentDate = new Date();
  refreshCalendar();
});

document.getElementById('view-week-btn').addEventListener('click', () => {
  document.getElementById('view-week-btn').classList.add('active');
  document.getElementById('view-day-btn').classList.remove('active');
  state.currentView = 'week';
  refreshCalendar();
});

document.getElementById('view-day-btn').addEventListener('click', () => {
  document.getElementById('view-day-btn').classList.add('active');
  document.getElementById('view-week-btn').classList.remove('active');
  state.currentView = 'day';
  refreshCalendar();
});

// Pitch Tab Controls
document.getElementById('pitch-tab-main').addEventListener('click', () => {
  document.getElementById('pitch-tab-main').classList.add('active');
  document.getElementById('pitch-tab-training').classList.remove('active');
  state.activeFieldMode = 'main';
  refreshCalendar();
});

document.getElementById('pitch-tab-training').addEventListener('click', () => {
  document.getElementById('pitch-tab-training').classList.add('active');
  document.getElementById('pitch-tab-main').classList.remove('active');
  state.activeFieldMode = 'training';
  refreshCalendar();
});

// Auth Submit & Reset DB
document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

document.getElementById('reset-db-btn').addEventListener('click', () => {
  if (confirm('Naozaj chcete resetovať celú lokálnu databázu a vymazať cache? Všetky vaše rezervácie budú vymazané.')) {
    localStorage.removeItem(MOCK_STORAGE_KEY);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showToast('Úspešne vymazané', 'Lokálna databáza bola resetovaná. Stránka sa znova načíta...', 'success');
    setTimeout(() => window.location.reload(), 1200);
  }
});

// Start Application
checkSession();