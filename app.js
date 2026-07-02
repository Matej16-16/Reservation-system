// 1. Firebase importy (musia byť úplne navrchu súboru)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 2. Tvoja Firebase konfigurácia
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};

// 3. Inicializácia databázy
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
const state = {
  token: localStorage.getItem('token') || null,
  user: JSON.parse(localStorage.getItem('user')) || null,
  currentDate: new Date(), // Active date for the calendar
  currentView: 'week', // 'week' | 'day'
  activeFieldMode: 'main', // 'main' | 'training'
  activeFieldFilters: new Set(), // Empty means show all
  fields: [],
  users: [], // Admin only
  reservations: [],
  fieldsMap: {}
};

// Calendar Time Window Limits
const START_HOUR = 8;
const END_HOUR = 21; // Last hour slot is 20:30 - 21:00
const SLOT_HEIGHT = 42; // px per 30 minutes, must match CSS --slot-height

// Drag Selection State
let isDragging = false;
let dragStartColIdx = null;
let dragStartSlotIdx = null;

// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
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

// ==========================================================================
// PURE JS SHA-256 HASH FALLBACK (for file:// and offline mode)
// ==========================================================================
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
  return hState.map(val => {
    const hex = (val >>> 0).toString(16);
    return hex.padStart(8, '0');
  }).join('');
}

// Resolve all overlapping/parent/child logic locally
function areFieldsConflicting(fieldId1, fieldId2) {
  if (fieldId1 === fieldId2) return true;
  if (!state.fieldsMap[fieldId1] || !state.fieldsMap[fieldId2]) return false;

  // Check if field1 is ancestor of field2
  let current = state.fieldsMap[fieldId2];
  while (current && current.parent_id) {
    if (current.parent_id === fieldId1) return true;
    current = state.fieldsMap[current.parent_id];
  }

  // Check if field2 is ancestor of field1
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
// TOAST NOTIFICATIONS ENGINE
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
// CLIENT-SIDE SIMULATED DATABASE (for standalone file:// launch)
// ==========================================================================
const DEFAULT_DB = {
  users: [
    {
      id: "u-admin",
      name: "Administrátor",
      email: "admin@fc.sk",
      password: "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9", // admin123
      role: "admin",
      color: "#ef4444"
    },
    {
      id: "u-u19",
      name: "Tréner U19",
      email: "u19@fc.sk",
      password: "10eb735dd6bb72154570722228be65dfe8b2bafe6273601a21ae3bd8f32b560d", // u19pwd
      role: "coach",
      color: "#3b82f6"
    },
    {
      id: "u-u15",
      name: "Tréner U15",
      email: "u15@fc.sk",
      password: "e0cb6268138dd065dc5e3cfb2649f11334944d8859d82a46b77ee16bfa760502", // u15pwd
      role: "coach",
      color: "#10b981"
    }
  ],
  fields: [
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
  ],
  reservations: []
};

const MOCK_STORAGE_KEY = 'fc_reservation_db';

function getLocalDB() {
  let dbStr = localStorage.getItem(MOCK_STORAGE_KEY);
  if (!dbStr) {
    dbStr = JSON.stringify(DEFAULT_DB);
    localStorage.setItem(MOCK_STORAGE_KEY, dbStr);
  }
  const db = JSON.parse(dbStr);
  
  // Migrate old incorrect password hashes from previous runs
  let updated = false;
  db.users.forEach(u => {
    if (u.email === 'admin@fc.sk' && u.password === '24075304b3cf68c348fa64a59f5b610c3f0f7cf4bdf341ba0c18d17bfa4429e7') {
      u.password = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
      updated = true;
    }
    if (u.email === 'u19@fc.sk' && u.password === '2bb62a5b6c8913b865668e1465bc5fb1e988cf7c186cc35bf4df051d960ccad1') {
      u.password = '10eb735dd6bb72154570722228be65dfe8b2bafe6273601a21ae3bd8f32b560d';
      updated = true;
    }
    if (u.email === 'u15@fc.sk' && u.password === '5cb3d4b68eef0003b879ec3e5fbf920fcd56e48c8bfa3a19b846059d68249826') {
      u.password = 'e0cb6268138dd065dc5e3cfb2649f11334944d8859d82a46b77ee16bfa760502';
      updated = true;
    }
  });
  
  if (updated) {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(db));
  }
  
  return db;
}

function saveLocalDB(db) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(db));
}

// Simulated API Handler
function simulateApiRequest(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    // Artificial delay to mimic server response
    setTimeout(() => {
      try {
        const db = getLocalDB();
        const urlObj = new URL(endpoint, 'http://localhost');
        const pathname = urlObj.pathname;
        const method = options.method || 'GET';
        const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : null;
        
        const pathParts = pathname.split('/').filter(Boolean); // e.g. ["auth", "login"] or ["reservations", "r-123"]

        // 1. AUTH: LOGIN
        if (pathParts[0] === 'auth' && pathParts[1] === 'login' && method === 'POST') {
          const { email, password } = body;
          const user = db.users.find(u => 
            (u.email && u.email.toLowerCase() === email.toLowerCase()) || 
            (u.name && u.name.toLowerCase() === email.toLowerCase())
          );
          
          if (!user || user.password !== sha256(password)) {
            return reject(new Error('Nesprávne prihlasovacie meno alebo heslo.'));
          }
          
          const simulatedToken = 'simulated-token-' + Math.random().toString(36).substring(2);
          localStorage.setItem('simulated_token', simulatedToken);
          localStorage.setItem('simulated_user_id', user.id);
          
          const userSafe = { ...user };
          delete userSafe.password;
          return resolve({ token: simulatedToken, user: userSafe });
        }

        // 2. AUTH: LOGOUT
        if (pathParts[0] === 'auth' && pathParts[1] === 'logout' && method === 'POST') {
          localStorage.removeItem('simulated_token');
          localStorage.removeItem('simulated_user_id');
          return resolve({ success: true });
        }

        // 3. AUTH: ME
        if (pathParts[0] === 'auth' && pathParts[1] === 'me' && method === 'GET') {
          const userId = localStorage.getItem('simulated_user_id');
          const user = db.users.find(u => u.id === userId);
          if (!user) {
            return reject(new Error('Relácia vypršala.'));
          }
          const userSafe = { ...user };
          delete userSafe.password;
          return resolve({ user: userSafe });
        }

        // 4. USERS
        if (pathParts[0] === 'users') {
          const activeUserId = localStorage.getItem('simulated_user_id');
          const activeUser = db.users.find(u => u.id === activeUserId);
          if (!activeUser || activeUser.role !== 'admin') {
            return reject(new Error('Nemáte oprávnenie na túto akciu.'));
          }

          // GET /users
          if (method === 'GET' && !pathParts[1]) {
            const usersSafe = db.users.map(u => {
              const us = { ...u };
              delete us.password;
              return us;
            });
            return resolve(usersSafe);
          }

          // POST /users
          if (method === 'POST' && !pathParts[1]) {
            const { name, email, password, role, color } = body;
            if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
              return reject(new Error('Používateľ s týmto názvom kategórie už existuje.'));
            }
            if (email && db.users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
              return reject(new Error('Používateľ s týmto e-mailom už existuje.'));
            }
            const newUser = {
              id: 'u-' + Math.random().toString(36).substring(2, 11),
              name,
              email: email ? email.toLowerCase() : '',
              password: sha256(password),
              role,
              color: color || '#8b5cf6'
            };
            db.users.push(newUser);
            saveLocalDB(db);
            
            const userSafe = { ...newUser };
            delete userSafe.password;
            return resolve(userSafe);
          }

          // DELETE /users/:id
          if (method === 'DELETE' && pathParts[1]) {
            const userIdToDelete = pathParts[1];
            if (userIdToDelete === activeUserId) {
              return reject(new Error('Nemôžete vymazať sám seba.'));
            }
            const idx = db.users.findIndex(u => u.id === userIdToDelete);
            if (idx === -1) return reject(new Error('Používateľ nenájdený.'));
            
            db.users.splice(idx, 1);
            db.reservations = db.reservations.filter(r => r.user_id !== userIdToDelete);
            saveLocalDB(db);
            return resolve({ success: true });
          }
        }

        // 5. FIELDS
        if (pathParts[0] === 'fields' && method === 'GET') {
          return resolve(db.fields);
        }

        // 6. RESERVATIONS
        if (pathParts[0] === 'reservations') {
          const activeUserId = localStorage.getItem('simulated_user_id');
          const activeUser = db.users.find(u => u.id === activeUserId);
          if (!activeUser) return reject(new Error('Relácia vypršala.'));

          // GET /reservations
          if (method === 'GET' && !pathParts[1]) {
            const startParam = urlObj.searchParams.get('start');
            const endParam = urlObj.searchParams.get('end');

            let list = db.reservations;
            if (startParam && endParam) {
              const s = new Date(startParam).getTime();
              const e = new Date(endParam).getTime();
              list = list.filter(r => {
                const rs = new Date(r.start_time).getTime();
                const re = new Date(r.end_time).getTime();
                return rs < e && re > s;
              });
            }

            const populated = list.map(r => {
              const u = db.users.find(usr => usr.id === r.user_id);
              return {
                ...r,
                user_name: u ? u.name : 'Neznámy tréner',
                user_color: u ? u.color : '#64748b'
              };
            });
            return resolve(populated);
          }

          // POST /reservations
          if (method === 'POST' && !pathParts[1]) {
            const { field_id, start_time, end_time, user_id } = body;
            
            // Check permissions
            let targetUserId = activeUser.id;
            if (activeUser.role === 'admin' && user_id) {
              targetUserId = user_id;
            }

            const targetUser = db.users.find(u => u.id === targetUserId);
            if (!targetUser) return reject(new Error('Tréner neexistuje.'));

            // Check conflict
            for (const r of db.reservations) {
              if (areTimesOverlapping(start_time, end_time, r.start_time, r.end_time)) {
                if (areFieldsConflicting(field_id, r.field_id)) {
                  const owner = db.users.find(u => u.id === r.user_id);
                  const ownerName = owner ? owner.name : 'Neznámy tréner';
                  const conflictField = db.fields.find(f => f.id === r.field_id);
                  const fieldName = conflictField ? conflictField.name : r.field_id;
                  return reject(new Error(`Konflikt: ${ownerName} už má v tomto čase rezervovanú plochu '${fieldName}'.`));
                }
              }
            }

            const newRes = {
              id: 'r-' + Math.random().toString(36).substring(2, 11),
              user_id: targetUserId,
              field_id,
              start_time: new Date(start_time).toISOString(),
              end_time: new Date(end_time).toISOString()
            };
            db.reservations.push(newRes);
            saveLocalDB(db);

            return resolve({
              ...newRes,
              user_name: targetUser.name,
              user_color: targetUser.color
            });
          }

          // PUT /reservations/:id
          if (method === 'PUT' && pathParts[1]) {
            const resId = pathParts[1];
            const idx = db.reservations.findIndex(r => r.id === resId);
            if (idx === -1) return reject(new Error('Rezervácia nenájdená.'));
            
            const existingRes = db.reservations[idx];
            if (activeUser.role !== 'admin' && existingRes.user_id !== activeUser.id) {
              return reject(new Error('Môžete upravovať iba svoje rezervácie.'));
            }

            const { field_id, start_time, end_time, user_id } = body;
            
            let targetUserId = existingRes.user_id;
            if (activeUser.role === 'admin' && user_id) {
              targetUserId = user_id;
            }
            const targetUser = db.users.find(u => u.id === targetUserId);
            if (!targetUser) return reject(new Error('Tréner neexistuje.'));

            // Check conflict
            for (const r of db.reservations) {
              if (r.id === resId) continue;
              if (areTimesOverlapping(start_time, end_time, r.start_time, r.end_time)) {
                if (areFieldsConflicting(field_id, r.field_id)) {
                  const owner = db.users.find(u => u.id === r.user_id);
                  const ownerName = owner ? owner.name : 'Neznámy tréner';
                  const conflictField = db.fields.find(f => f.id === r.field_id);
                  const fieldName = conflictField ? conflictField.name : r.field_id;
                  return reject(new Error(`Konflikt: ${ownerName} už má v tomto čase rezervovanú plochu '${fieldName}'.`));
                }
              }
            }

            existingRes.field_id = field_id;
            existingRes.start_time = new Date(start_time).toISOString();
            existingRes.end_time = new Date(end_time).toISOString();
            existingRes.user_id = targetUserId;
            
            saveLocalDB(db);
            return resolve({
              ...existingRes,
              user_name: targetUser.name,
              user_color: targetUser.color
            });
          }

          // DELETE /reservations/:id
          if (method === 'DELETE' && pathParts[1]) {
            const resId = pathParts[1];
            const idx = db.reservations.findIndex(r => r.id === resId);
            if (idx === -1) return reject(new Error('Rezervácia nenájdená.'));
            
            const existingRes = db.reservations[idx];
            if (activeUser.role !== 'admin' && existingRes.user_id !== activeUser.id) {
              return reject(new Error('Môžete mazať iba svoje rezervácie.'));
            }

            db.reservations.splice(idx, 1);
            saveLocalDB(db);
            return resolve({ success: true });
          }
        }

        // Catch all
        reject(new Error('Metóda alebo cesta nebola nájdená.'));
      } catch (err) {
        reject(err);
      }
    }, 100);
  });
}

// ==========================================================================
// API CLIENT WITH AUTOMATIC OFFLINE SIMULATION FALLBACK
// ==========================================================================
async function apiRequest(endpoint, options = {}) {
  const isLocalFile = window.location.protocol === 'file:';
  
  if (isLocalFile || window.useLocalSimulation) {
    return simulateApiRequest(endpoint, options);
  }

  try {
    const url = `/api${endpoint}`;
    options.headers = options.headers || {};
    if (state.token) {
      options.headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (options.body && typeof options.body === 'object') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    
    const res = await fetch(url, options);
    
    if (res.status === 401) {
      handleLogout();
      throw new Error('Vaša relácia vypršala. Prihláste sa znova.');
    }
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Pri spracovaní požiadavky došlo k chybe.');
    }
    return data;
  } catch (err) {
    // If it is a connection error (server offline/unreachable)
    const isNetworkError = err.message.includes('Failed to fetch') || 
                           err.message.includes('NetworkError') || 
                           err.message.includes('unreachable') || 
                           err.name === 'TypeError';
                           
    if (isNetworkError) {
      console.warn('API server is unreachable. Switching client to local storage mode.');
      window.useLocalSimulation = true;
      
      // Load local token & user if exists
      const simToken = localStorage.getItem('simulated_token');
      if (simToken) {
        state.token = simToken;
        // Fetch user locally
        try {
          const meData = await simulateApiRequest('/auth/me');
          state.user = meData.user;
        } catch (e) {
          state.token = null;
          state.user = null;
        }
      } else {
        state.token = null;
        state.user = null;
      }
      
      showToast('Lokálny režim aktívny', 'Server je nedostupný. Dáta sa ukladajú lokálne vo vašom prehliadači.', 'info');
      
      return simulateApiRequest(endpoint, options);
    }
    throw err;
  }
}

// ==========================================================================
// AUTH FLOW
// ==========================================================================
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    showToast('Prihlásenie úspešné', `Vitajte, ${state.user.name}!`);
    initDashboard();
  } catch (err) {
    showToast('Chyba prihlásenia', err.message, 'error');
  }
}

async function handleLogout() {
  if (state.token) {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('API logout failed', e);
    }
  }
  
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('simulated_token');
  localStorage.removeItem('simulated_user_id');
  
  state.activeFieldFilters.clear();
  showLoginView();
}

async function checkSession() {
  const isLocalFile = window.location.protocol === 'file:';
  
  if (isLocalFile) {
    window.useLocalSimulation = true;
    const simToken = localStorage.getItem('simulated_token');
    if (!simToken) {
      showLoginView();
      return;
    }
    try {
      const data = await simulateApiRequest('/auth/me');
      state.token = simToken;
      state.user = data.user;
      initDashboard();
    } catch (err) {
      handleLogout();
    }
    return;
  }

  if (!state.token) {
    showLoginView();
    return;
  }

  try {
    const data = await apiRequest('/auth/me');
    state.user = data.user;
    localStorage.setItem('user', JSON.stringify(data.user));
    initDashboard();
  } catch (err) {
    handleLogout();
  }
}

function showLoginView() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('dashboard-section').classList.add('hidden');
}

// ==========================================================================
// DASHBOARD INITIALIZATION
// ==========================================================================
async function initDashboard() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');

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

  try {
    state.fields = await apiRequest('/fields');
    state.fieldsMap = {};
    state.fields.forEach(f => {
      state.fieldsMap[f.id] = f;
    });

    populateFieldsDropdowns();
    renderPitchMap();
    renderMiniPitchMap();
    
    if (state.user.role === 'admin') {
      loadAdminUsers();
    }

    await refreshCalendar();
  } catch (err) {
    showToast('Chyba inicializácie', 'Nepodarilo sa načítať dáta.', 'error');
  }
}

function populateFieldsDropdowns() {
  const resFieldSelect = document.getElementById('res-field-id');
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

// ==========================================================================
// INTERACTIVE PITCH MAP CONTROLLER
// ==========================================================================
// ==========================================================================
// PITCH MAP VISUAL HIGHLIGHTS
// ==========================================================================
function renderPitchMap() {
  const trainingPitchCard = document.querySelector('.left-panel .training-pitch');
  const mainPitchCard = document.querySelector('.left-panel .main-pitch');
  
  if (!trainingPitchCard || !mainPitchCard) return;

  if (state.activeFieldMode === 'training') {
    trainingPitchCard.classList.remove('filtered-out');
    trainingPitchCard.classList.add('active-filter');
    mainPitchCard.classList.remove('active-filter');
    mainPitchCard.classList.add('filtered-out');
  } else {
    mainPitchCard.classList.remove('filtered-out');
    mainPitchCard.classList.add('active-filter');
    trainingPitchCard.classList.remove('active-filter');
    trainingPitchCard.classList.add('filtered-out');
  }
}

function renderMiniPitchMap() {
  const miniCards = document.querySelectorAll('.modal-pitch-helper .mini-pitch-card, .modal-pitch-helper .mini-half, .modal-pitch-helper .mini-quarter');
  const selectElement = document.getElementById('res-field-id');

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
// CALENDAR RENDER ENGINE (SPLIT-LANE LAYOUT)
// ==========================================================================
async function refreshCalendar() {
  const range = getCalendarDateRange();
  
  try {
    state.reservations = await apiRequest(`/reservations?start=${range.start.toISOString()}&end=${range.end.toISOString()}`);
    renderCalendarGrid();
    renderReservationsOverlay();
    renderPitchMap();
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
  
  // Both fields are now split into 4 lanes
  const totalGridCols = numDays * 4; // 28 for week, 4 for day
  
  document.documentElement.style.setProperty('--num-columns', totalGridCols);
  
  const headerGrid = document.getElementById('calendar-header-grid');
  headerGrid.innerHTML = '<div class="time-column-header"></div>';
  
  const todayStr = formatDateISO(new Date());

  // 2-Tier header for both Main and Training fields
  // Row 1: Day headers spanning 4 columns
  days.forEach((day, dIdx) => {
    const isToday = formatDateISO(day) === todayStr;
    const dayHeader = document.createElement('div');
    dayHeader.className = `day-column-header-span ${isToday ? 'is-today' : ''}`;
    
    const startCol = 2 + dIdx * 4; // 1 is axis, 2 is start
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

  // Update date text title
  const title = document.getElementById('calendar-week-range');
  if (state.currentView === 'day') {
    title.textContent = formatDisplayDate(state.currentDate) + ` ${state.currentDate.getFullYear()}`;
  } else {
    const monday = days[0];
    const sunday = days[6];
    const mStr = `${monday.getDate()}. ${monday.getMonth() + 1}.`;
    const sStr = `${sunday.getDate()}. ${sunday.getMonth() + 1}.`;
    title.textContent = `${mStr} – ${sStr} ${sunday.getFullYear()}`;
  }

  // Render cells in body grid
  const bodyGrid = document.getElementById('calendar-body-grid');
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
  overlay.innerHTML = '';

  const days = getDaysOfCurrentView();
  const numDays = days.length;
  const daysStrMap = days.map(d => formatDateISO(d));

  // Determine total columns (excluding axis) - both are now split into 4 lanes
  const totalGridCols = numDays * 4;
  const lanesPerDay = 4;

  // Filter reservations based on active mode (starts with training_ vs doesn't)
  const filteredReservations = state.reservations.filter(res => {
    const isTrainingRes = res.field_id.startsWith('training_');
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
    if (dayColumnIdx === -1) return; // not in current view

    // Calculate vertical coordinates in slots (30 minutes each)
    const startHour = localStart.getHours();
    const startMin = localStart.getMinutes();
    const endHour = localEnd.getHours();
    const endMin = localEnd.getMinutes();

    // Convert start and end times to minutes since calendar START_HOUR
    const calendarStartMins = START_HOUR * 60;
    const startMins = startHour * 60 + startMin - calendarStartMins;
    const endMins = endHour * 60 + endMin - calendarStartMins;

    // Clamp coordinates to calendar grid height
    const calendarHeightMins = (END_HOUR - START_HOUR) * 60;
    const clampedStartMins = Math.max(0, Math.min(calendarHeightMins, startMins));
    const clampedEndMins = Math.max(0, Math.min(calendarHeightMins, endMins));
    
    if (clampedStartMins >= clampedEndMins) return; // outside calendar hours

    // Convert to px
    const top = (clampedStartMins / 30) * SLOT_HEIGHT;
    const height = ((clampedEndMins - clampedStartMins) / 30) * SLOT_HEIGHT;

    // Calculate horizontal lane offset & span (X placement)
    let laneOffset = 0;
    let laneSpan = 1;

    const fieldId = res.field_id;
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

    // Card Element
    const card = document.createElement('div');
    card.className = 'reservation-card';
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;
    card.style.left = `calc(${leftPercent}% + 2px)`;
    card.style.width = `calc(${widthPercent}% - 4px)`;
    card.style.setProperty('--card-accent', res.user_color);
    card.style.backgroundColor = `${res.user_color}24`; // 14% opacity

    const formatTimeStr = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fieldName = state.fieldsMap[res.field_id] ? state.fieldsMap[res.field_id].name : res.field_id;

    card.innerHTML = `
      <div class="res-card-header">
        <span class="res-card-coach" style="font-weight: 700;">${res.user_name}</span>
        <span class="res-card-time" style="font-size: 0.6rem;">${formatTimeStr(localStart)} - ${formatTimeStr(localEnd)}</span>
      </div>
      <div class="res-card-field">${fieldName}</div>
    `;

    const isOwner = res.user_id === state.user.id;
    const isAdmin = state.user.role === 'admin';
    
    if (isAdmin || isOwner) {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        openReservationModal(res);
      });
    } else {
      card.style.cursor = 'not-allowed';
      card.title = `Rezervácia tímu ${res.user_name} (Nemáte oprávnenie upravovať)`;
    }

    overlay.appendChild(card);
  });
}

// Category legend list is removed as per user request

// ==========================================================================
// DRAG & DROP / RANGE SELECTION
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
  if (colIdx !== dragStartColIdx) return; // restrict to single lane column

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
  let colIdx = dragStartColIdx;

  selectedCells.forEach(cell => {
    const sIdx = parseInt(cell.getAttribute('data-slot-idx'));
    if (sIdx < minIdx) minIdx = sIdx;
    if (sIdx > maxIdx) maxIdx = sIdx;
  });

  clearDragSelectionStyles();

  // Find dayIdx and fieldId from one of the cells
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
// RESERVATION MODAL CONTROLLER
// ==========================================================================
function openReservationModal(res = null) {
  const modal = document.getElementById('reservation-modal');
  const form = document.getElementById('reservation-form');
  const deleteBtn = document.getElementById('delete-res-btn');
  const title = document.getElementById('modal-title');

  form.reset();
  populateTimeSelects();

  if (res && res.id) {
    title.textContent = 'Upraviť rezerváciu plochy';
    document.getElementById('res-id').value = res.id;
    document.getElementById('res-field-id').value = res.field_id;
    
    if (state.user.role === 'admin') {
      deleteBtn.classList.remove('hidden');
      document.getElementById('res-user-id').value = res.user_id;
    } else if (res.user_id === state.user.id) {
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }

    const localStart = new Date(res.start_time);
    const localEnd = new Date(res.end_time);
    
    document.getElementById('res-date').value = formatDateISO(localStart);
    document.getElementById('res-start-time').value = formatTimePadding(localStart);
    document.getElementById('res-end-time').value = formatTimePadding(localEnd);
  } else {
    title.textContent = 'Nová rezervácia plochy';
    document.getElementById('res-id').value = '';
    deleteBtn.classList.add('hidden');

    if (state.user.role === 'admin') {
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
  }

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
  
  const startDate = new Date(`${dateStr}T${startStr}:00`);
  const endDate = new Date(`${dateStr}T${endStr}:00`);

  if (startDate.getTime() >= endDate.getTime()) {
    showToast('Neplatný časový rozsah', 'Koniec rezervácie musí byť neskôr ako začiatok.', 'error');
    return;
  }

  const payload = {
    field_id: fieldId,
    start_time: startDate.toISOString(),
    end_time: endDate.toISOString()
  };

  if (state.user.role === 'admin') {
    payload.user_id = document.getElementById('res-user-id').value;
  }

  try {
    if (id) {
      await apiRequest(`/reservations/${id}`, {
        method: 'PUT',
        body: payload
      });
      showToast('Rezervácia upravená', 'Zmeny boli úspešne uložené.');
    } else {
      await apiRequest('/reservations', {
        method: 'POST',
        body: payload
      });
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
    await apiRequest(`/reservations/${id}`, {
      method: 'DELETE'
    });
    showToast('Rezervácia zmazaná', 'Rezervácia bola úspešne vymazaná.');
    closeModal();
    refreshCalendar();
  } catch (err) {
    showToast('Chyba mazania', err.message, 'error');
  }
}

function closeModal() {
  document.getElementById('reservation-modal').classList.add('hidden');
}

document.getElementById('close-modal-btn').addEventListener('click', closeModal);
document.getElementById('cancel-res-btn').addEventListener('click', closeModal);
document.getElementById('reservation-form').addEventListener('submit', saveReservation);
document.getElementById('delete-res-btn').addEventListener('click', deleteReservation);

// ==========================================================================
// ADMIN DASHBOARD CONTROLLER (USER ACCOUNTS)
// ==========================================================================
async function loadAdminUsers() {
  try {
    state.users = await apiRequest('/users');
    
    const userSelect = document.getElementById('res-user-id');
    userSelect.innerHTML = '';
    state.users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.role === 'admin' ? 'Admin' : 'Tréner'})`;
      userSelect.appendChild(opt);
    });

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
    
    const isSelf = u.id === state.user.id;
    
    item.innerHTML = `
      <div class="user-list-info">
        <span class="user-color-dot" style="background-color: ${u.color || '#4b5563'};"></span>
        <div>
          <div class="user-list-name">${u.name} <span class="user-list-role">${u.role}</span></div>
          <div class="user-list-email">${u.email}</div>
        </div>
      </div>
      ${isSelf ? '' : `<button class="btn btn-danger btn-link btn-xs delete-user-btn" data-user-id="${u.id}">&times; Zmazať</button>`}
    `;

    if (!isSelf) {
      item.querySelector('.delete-user-btn').addEventListener('click', () => deleteUserAccount(u.id, u.name));
    }

    container.appendChild(item);
  });
}

async function handleCreateUserAccount(e) {
  e.preventDefault();
  const name = document.getElementById('user-name').value;
  const email = document.getElementById('user-email').value;
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
    await apiRequest(`/users/${userId}`, {
      method: 'DELETE'
    });
    showToast('Profil vymazaný', `Profil trénera a všetky jeho rezervácie boli úspešne odstránené.`);
    
    await loadAdminUsers();
    await refreshCalendar();
  } catch (err) {
    showToast('Chyba vymazania profilu', err.message, 'error');
  }
}

const dashboardSection = document.getElementById('dashboard-section');
const adminSection = document.getElementById('admin-section');

document.getElementById('admin-toggle-btn').addEventListener('click', () => {
  dashboardSection.classList.add('hidden');
  adminSection.classList.remove('hidden');
  loadAdminUsers();
});

document.getElementById('admin-back-btn').addEventListener('click', () => {
  adminSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
});

document.getElementById('create-user-form').addEventListener('submit', handleCreateUserAccount);

// ==========================================================================
// CALENDAR NAVIGATION BINDINGS
// ==========================================================================
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

document.getElementById('view-week-btn').addEventListener('click', (e) => {
  document.getElementById('view-week-btn').classList.add('active');
  document.getElementById('view-day-btn').classList.remove('active');
  state.currentView = 'week';
  refreshCalendar();
});

document.getElementById('view-day-btn').addEventListener('click', (e) => {
  document.getElementById('view-day-btn').classList.add('active');
  document.getElementById('view-week-btn').classList.remove('active');
  state.currentView = 'day';
  refreshCalendar();
});

// Pitch tab controls
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

// ==========================================================================
// GLOBAL EVENT LISTENERS & INITS
// ==========================================================================
document.getElementById('login-form').addEventListener('submit', handleLogin);
document.getElementById('logout-btn').addEventListener('click', handleLogout);

// Database Reset Button
document.getElementById('reset-db-btn').addEventListener('click', () => {
  if (confirm('Naozaj chcete resetovať celú lokálnu databázu a vymazať cache? Všetky vaše rezervácie budú vymazané.')) {
    localStorage.removeItem(MOCK_STORAGE_KEY);
    localStorage.removeItem('simulated_token');
    localStorage.removeItem('simulated_user_id');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showToast('Úspešne vymazané', 'Lokálna databáza bola úspešne resetovaná. Stránka sa znova načíta...', 'success');
    setTimeout(() => window.location.reload(), 1500);
  }
});

checkSession();
