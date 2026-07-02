const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// In-memory sessions store
// Token -> { userId, expiresAt }
const sessions = {};

// Helper to read DB
function readDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    return { users: [], fields: [], reservations: [] };
  }
}

// Helper to write DB (atomic & safe write)
function writeDB(data) {
  try {
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
    return false;
  }
}

// SHA-256 password hash helper
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// UUID generator
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
}

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Session retriever middleware
function getSessionUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const session = sessions[token];
  if (!session) return null;
  if (new Date() > session.expiresAt) {
    delete sessions[token]; // expired
    return null;
  }
  // Refresh session expiry
  session.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const db = readDB();
  return db.users.find(u => u.id === session.userId) || null;
}

// Conflict logic checkers
function areFieldsConflicting(fieldId1, fieldId2, fieldsMap) {
  if (fieldId1 === fieldId2) return true;

  // Check if field1 is ancestor of field2
  let current = fieldsMap[fieldId2];
  while (current && current.parent_id) {
    if (current.parent_id === fieldId1) return true;
    current = fieldsMap[current.parent_id];
  }

  // Check if field2 is ancestor of field1
  current = fieldsMap[fieldId1];
  while (current && current.parent_id) {
    if (current.parent_id === fieldId2) return true;
    current = fieldsMap[current.parent_id];
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

// Helper to respond with JSON
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Main Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Enable CORS for testing if needed
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ----------------------------------------------------
  // API Routes
  // ----------------------------------------------------

  // 1. AUTH: LOGIN
  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const { email, password } = await parseJsonBody(req);
      if (!email || !password) {
        return sendJSON(res, 400, { error: 'Missing fields', message: 'Prihlasovacie meno a heslo sú povinné.' });
      }

      const db = readDB();
      const user = db.users.find(u => 
        (u.email && u.email.toLowerCase() === email.toLowerCase()) || 
        (u.name && u.name.toLowerCase() === email.toLowerCase())
      );
      if (!user || user.password !== hashPassword(password)) {
        return sendJSON(res, 401, { error: 'Unauthorized', message: 'Nesprávne prihlasovacie meno alebo heslo.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      sessions[token] = {
        userId: user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      };

      const userSafe = { ...user };
      delete userSafe.password;

      return sendJSON(res, 200, { token, user: userSafe });
    } catch (err) {
      return sendJSON(res, 400, { error: 'Bad Request', message: 'Neplatný formát dát.' });
    }
  }

  // 2. AUTH: LOGOUT
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      delete sessions[token];
    }
    return sendJSON(res, 200, { success: true, message: 'Odhlásenie úspešné.' });
  }

  // 3. AUTH: ME
  if (pathname === '/api/auth/me' && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized', message: 'Relácia vypršala.' });
    }
    const userSafe = { ...currentUser };
    delete userSafe.password;
    return sendJSON(res, 200, { user: userSafe });
  }

  // 4. USERS API (Admin Only)
  if (pathname === '/api/users' && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser || currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden', message: 'Nemáte oprávnenie na túto akciu.' });
    }
    const db = readDB();
    const usersSafe = db.users.map(u => {
      const uSafe = { ...u };
      delete uSafe.password;
      return uSafe;
    });
    return sendJSON(res, 200, usersSafe);
  }

  if (pathname === '/api/users' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser || currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden', message: 'Nemáte oprávnenie na túto akciu.' });
    }

    try {
      const { name, email, password, role, color } = await parseJsonBody(req);
      if (!name || !password || !role) {
        return sendJSON(res, 400, { error: 'Missing fields', message: 'Meno, heslo a rola sú povinné.' });
      }

      if (!['admin', 'coach'].includes(role)) {
        return sendJSON(res, 400, { error: 'Invalid role', message: 'Neplatná rola.' });
      }

      const db = readDB();
      if (db.users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
        return sendJSON(res, 409, { error: 'Conflict', message: 'Používateľ s týmto názvom kategórie už existuje.' });
      }
      if (email && db.users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) {
        return sendJSON(res, 409, { error: 'Conflict', message: 'Používateľ s týmto e-mailom už existuje.' });
      }

      const newUser = {
        id: 'u-' + generateId(),
        name,
        email: email ? email.toLowerCase() : '',
        password: hashPassword(password),
        role,
        color: color || '#ef4444'
      };

      db.users.push(newUser);
      writeDB(db);

      const userSafe = { ...newUser };
      delete userSafe.password;
      return sendJSON(res, 201, userSafe);
    } catch (err) {
      return sendJSON(res, 400, { error: 'Bad Request', message: 'Neplatný formát dát.' });
    }
  }

  if (pathname.startsWith('/api/users/') && method === 'DELETE') {
    const currentUser = getSessionUser(req);
    if (!currentUser || currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden', message: 'Nemáte oprávnenie na túto akciu.' });
    }

    const userIdToDelete = pathname.substring(11);
    if (userIdToDelete === currentUser.id) {
      return sendJSON(res, 400, { error: 'Bad Request', message: 'Nemôžete vymazať sám seba.' });
    }

    const db = readDB();
    const userIndex = db.users.findIndex(u => u.id === userIdToDelete);
    if (userIndex === -1) {
      return sendJSON(res, 404, { error: 'Not Found', message: 'Používateľ sa nenašiel.' });
    }

    // Delete user
    db.users.splice(userIndex, 1);
    // Cascade delete their reservations
    db.reservations = db.reservations.filter(r => r.user_id !== userIdToDelete);

    writeDB(db);
    return sendJSON(res, 200, { success: true, message: 'Používateľ a jeho rezervácie boli zmazané.' });
  }

  // 5. FIELDS API (Public authenticated)
  if (pathname === '/api/fields' && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized', message: 'Relácia vypršala.' });
    }
    const db = readDB();
    return sendJSON(res, 200, db.fields);
  }

  // 6. RESERVATIONS API
  if (pathname === '/api/reservations' && method === 'GET') {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized', message: 'Relácia vypršala.' });
    }

    const db = readDB();
    const startParam = parsedUrl.searchParams.get('start');
    const endParam = parsedUrl.searchParams.get('end');

    let reservations = db.reservations;

    // Filter by date range if provided
    if (startParam && endParam) {
      const s = new Date(startParam).getTime();
      const e = new Date(endParam).getTime();
      reservations = reservations.filter(r => {
        const rs = new Date(r.start_time).getTime();
        const re = new Date(r.end_time).getTime();
        return rs < e && re > s;
      });
    }

    // Populate user info
    const populated = reservations.map(r => {
      const user = db.users.find(u => u.id === r.user_id);
      return {
        ...r,
        user_name: user ? user.name : 'Neznámy tréner',
        user_color: user ? user.color : '#64748b'
      };
    });

    return sendJSON(res, 200, populated);
  }

  if (pathname === '/api/reservations' && method === 'POST') {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized', message: 'Relácia vypršala.' });
    }

    try {
      const { field_id, start_time, end_time, user_id } = await parseJsonBody(req);
      if (!field_id || !start_time || !end_time) {
        return sendJSON(res, 400, { error: 'Missing fields', message: 'Plocha, začiatok a koniec sú povinné.' });
      }

      const sDate = new Date(start_time);
      const eDate = new Date(end_time);
      if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
        return sendJSON(res, 400, { error: 'Invalid dates', message: 'Neplatný formát dátumu a času.' });
      }

      if (sDate.getTime() >= eDate.getTime()) {
        return sendJSON(res, 400, { error: 'Bad Range', message: 'Začiatok rezervácie musí byť pred jej koncom.' });
      }

      const db = readDB();

      // Validate field exists
      const field = db.fields.find(f => f.id === field_id);
      if (!field) {
        return sendJSON(res, 400, { error: 'Invalid field', message: 'Zvolená plocha neexistuje.' });
      }

      // Check user permissions: coach can only reserve for themselves
      let targetUserId = currentUser.id;
      if (currentUser.role === 'admin' && user_id) {
        targetUserId = user_id;
      }

      // Validate the target user exists
      const targetUser = db.users.find(u => u.id === targetUserId);
      if (!targetUser) {
        return sendJSON(res, 400, { error: 'Invalid user', message: 'Cieľový tréner neexistuje.' });
      }

      // Conflict logic
      const fieldsMap = {};
      db.fields.forEach(f => { fieldsMap[f.id] = f; });

      for (const existing of db.reservations) {
        if (areTimesOverlapping(start_time, end_time, existing.start_time, existing.end_time)) {
          if (areFieldsConflicting(field_id, existing.field_id, fieldsMap)) {
            const owner = db.users.find(u => u.id === existing.user_id);
            const ownerName = owner ? owner.name : 'Neznámy tréner';
            const conflictField = db.fields.find(f => f.id === existing.field_id);
            const fieldName = conflictField ? conflictField.name : existing.field_id;
            
            return sendJSON(res, 409, {
              error: 'Conflict',
              message: `Konflikt rezervácie: ${ownerName} už má v tomto čase rezervovanú plochu '${fieldName}'.`
            });
          }
        }
      }

      const newRes = {
        id: 'r-' + generateId(),
        user_id: targetUserId,
        field_id,
        start_time: sDate.toISOString(),
        end_time: eDate.toISOString()
      };

      db.reservations.push(newRes);
      writeDB(db);

      // Return populated
      return sendJSON(res, 201, {
        ...newRes,
        user_name: targetUser.name,
        user_color: targetUser.color
      });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 400, { error: 'Bad Request', message: 'Neplatný formát dát.' });
    }
  }

  if (pathname.startsWith('/api/reservations/') && (method === 'PUT' || method === 'DELETE')) {
    const currentUser = getSessionUser(req);
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized', message: 'Relácia vypršala.' });
    }

    const resId = pathname.substring(18);
    const db = readDB();
    const resIndex = db.reservations.findIndex(r => r.id === resId);

    if (resIndex === -1) {
      return sendJSON(res, 404, { error: 'Not Found', message: 'Rezervácia sa nenašla.' });
    }

    const existingRes = db.reservations[resIndex];

    // Check auth: Admin can edit/delete anything. Coach can only edit/delete their own.
    if (currentUser.role !== 'admin' && existingRes.user_id !== currentUser.id) {
      return sendJSON(res, 403, { error: 'Forbidden', message: 'Môžete upravovať alebo mazať iba svoje vlastné rezervácie.' });
    }

    if (method === 'DELETE') {
      db.reservations.splice(resIndex, 1);
      writeDB(db);
      return sendJSON(res, 200, { success: true, message: 'Rezervácia bola úspešne zmazaná.' });
    }

    if (method === 'PUT') {
      try {
        const { field_id, start_time, end_time, user_id } = await parseJsonBody(req);
        if (!field_id || !start_time || !end_time) {
          return sendJSON(res, 400, { error: 'Missing fields', message: 'Plocha, začiatok a koniec sú povinné.' });
        }

        const sDate = new Date(start_time);
        const eDate = new Date(end_time);
        if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
          return sendJSON(res, 400, { error: 'Invalid dates', message: 'Neplatný formát dátumu a času.' });
        }

        if (sDate.getTime() >= eDate.getTime()) {
          return sendJSON(res, 400, { error: 'Bad Range', message: 'Začiatok rezervácie musí byť pred jej koncom.' });
        }

        const field = db.fields.find(f => f.id === field_id);
        if (!field) {
          return sendJSON(res, 400, { error: 'Invalid field', message: 'Zvolená plocha neexistuje.' });
        }

        // Target user: coach cannot change user, admin can change user
        let targetUserId = existingRes.user_id;
        if (currentUser.role === 'admin' && user_id) {
          targetUserId = user_id;
        }

        const targetUser = db.users.find(u => u.id === targetUserId);
        if (!targetUser) {
          return sendJSON(res, 400, { error: 'Invalid user', message: 'Cieľový tréner neexistuje.' });
        }

        // Conflict check excluding this reservation
        const fieldsMap = {};
        db.fields.forEach(f => { fieldsMap[f.id] = f; });

        for (const r of db.reservations) {
          if (r.id === resId) continue; // skip self

          if (areTimesOverlapping(start_time, end_time, r.start_time, r.end_time)) {
            if (areFieldsConflicting(field_id, r.field_id, fieldsMap)) {
              const owner = db.users.find(u => u.id === r.user_id);
              const ownerName = owner ? owner.name : 'Neznámy tréner';
              const conflictField = db.fields.find(f => f.id === r.field_id);
              const fieldName = conflictField ? conflictField.name : r.field_id;

              return sendJSON(res, 409, {
                error: 'Conflict',
                message: `Konflikt rezervácie: ${ownerName} už má v tomto čase rezervovanú plochu '${fieldName}'.`
              });
            }
          }
        }

        // Update
        existingRes.field_id = field_id;
        existingRes.start_time = sDate.toISOString();
        existingRes.end_time = eDate.toISOString();
        existingRes.user_id = targetUserId;

        writeDB(db);

        return sendJSON(res, 200, {
          ...existingRes,
          user_name: targetUser.name,
          user_color: targetUser.color
        });
      } catch (err) {
        console.error(err);
        return sendJSON(res, 400, { error: 'Bad Request', message: 'Neplatný formát dát.' });
      }
    }
  }

  // ----------------------------------------------------
  // Static File Server
  // ----------------------------------------------------
  if (method === 'GET') {
    const reqPath = pathname;
    const filePath = path.join(__dirname, 'public', reqPath === '/' ? 'index.html' : reqPath);

    // Path traversal check
    const publicDir = path.join(__dirname, 'public');
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Prístup odmietnutý');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Súbor nenájdený');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'text/plain; charset=utf-8';
      if (ext === '.html') contentType = 'text/html; charset=utf-8';
      else if (ext === '.css') contentType = 'text/css; charset=utf-8';
      else if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
      else if (ext === '.json') contentType = 'application/json; charset=utf-8';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.svg') contentType = 'image/svg+xml; charset=utf-8';
      else if (ext === '.ico') contentType = 'image/x-icon';

      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // 404 for any other unhandled endpoint
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found', message: 'Požadovaná adresa neexistuje.' }));
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
