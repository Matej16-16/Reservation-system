// 1. Firebase importy (musia byť úplne navrchu súboru)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 2. Tvoja Firebase konfigurácia (Doplň svoje reálne údaje z Firebase konzoly)
  const firebaseConfig = {
    apiKey: "AIzaSyCQzACNpvwUztab2kExKvKVct92eH2Ekxs",
    authDomain: "reservation-system-b6f7d.firebaseapp.com",
    projectId: "reservation-system-b6f7d",
    storageBucket: "reservation-system-b6f7d.firebasestorage.app",
    messagingSenderId: "169143178876",
    appId: "1:169143178876:web:825b366e9b14baaec89bf9",
    measurementId: "G-NB9JSN35WL"
  };

// 3. Inicializácia Firebase služieb
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ==========================================================================
// STATE MANAGEMENT
// ==========================================================================
const state = {
  token: null,
  user: null,
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
// API CLIENT TO CONNECT WITH FIRESTORE
// ==========================================================================
async function apiRequest(endpoint, options = {}) {
  // TODO: Tu neskôr prepojíme načítanie polí a rezervácií z Firestore databázy (db)
  // Nateraz vraciame prázdne polia, aby aplikácia nespadla
  if (endpoint.startsWith('/fields')) {
    return [
      { id: "training_full", name: "Celé tréningové ihrisko", parent_id: null },
      { id: "training_half_a", name: "Trén. Polovica A", parent_id: "training_full" },
      { id: "training_half_b", name: "Trén. Polovica B", parent_id: "training_full" },
      { id: "main_full", name: "Celé hlavné ihrisko", parent_id: null },
      { id: "main_half_a", name: "Polovica A", parent_id: "main_full" },
      { id: "main_half_b", name: "Polovica B", parent_id: "main_full" }
    ];
  }
  if (endpoint.startsWith('/reservations')) {
    return [];
  }
  return [];
}

// ==========================================================================
// AUTH FLOW (Konečne prepojené na reálny Firebase)
// ==========================================================================
async function handleLogin(e) {
  e.preventDefault();
  let emailOrUsername = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  // TRIK: Ak tréner nezadal zavináč, spravíme z mena "u19" e-mail "u19@fc.sk"
  if (!emailOrUsername.includes('@')) {
    emailOrUsername = `${emailOrUsername}@fc.sk`;
  }

  try {
    // Prihlásenie priamo cez Firebase Auth
    const userCredential = await signInWithEmailAndPassword(auth, emailOrUsername, password);
    const user = userCredential.user;

    state.token = await user.getIdToken();
    state.user = {
      id: user.uid,
      name: user.email.split('@')[0], // Z "u19@fc.sk" urobí pekné meno "u19"
      email: user.email,
      role: user.email.includes('admin') ? 'admin' : 'coach',
      color: '#3b82f6'
    };

    showToast('Prihlásenie úspešné', `Vitajte!`);
    initDashboard();
  } catch (err) {
    showToast('Chyba prihlásenia', 'Nesprávne používateľské meno alebo heslo.', 'error');
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    state.token = null;
    state.user = null;
    state.activeFieldFilters.clear();
    showLoginView();
    showToast('Odhlásené', 'Boli ste úspešne odhlásený.');
  } catch (e) {
    console.error('Logout failed', e);
  }
}

// Sledovanie relácie priamo cez Firebase
function checkSession() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.token = await user.getIdToken();
      state.user = {
        id: user.uid,
        name: user.email.split('@')[0],
        email: user.email,
        role: user.email.includes('admin') ? 'admin' : 'coach',
        color: '#3b82f6'
      };
      initDashboard();
    } else {
      showLoginView();
    }
  });
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
  if(!resFieldSelect) return;
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
  if(!selectElement) return;

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
// CALENDAR RENDER ENGINE
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
  const totalGridCols = numDays * 4;
  
  document.documentElement.style.setProperty('--num-columns', totalGridCols);
  
  const headerGrid = document.getElementById('calendar-header-grid');
  if(!headerGrid) return;
  headerGrid.innerHTML = '<div class="time-column-header"></div>';
  
  const todayStr = formatDateISO(new Date());

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
  if(title) {
    if (state.currentView === 'day') {
      title.textContent = formatDisplayDate(state.currentDate) + ` ${state.currentDate.getFullYear()}`;
    } else {
      const monday = days[0];
      const sunday = days[6];
      title.textContent = `${monday.getDate()}. ${monday.getMonth