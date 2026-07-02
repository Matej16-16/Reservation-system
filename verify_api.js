const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Test port
const TEST_PORT = 3001;
let serverProcess = null;
let dbBackup = null;

// Backup database
const dbPath = path.join(__dirname, 'db.json');
if (fs.existsSync(dbPath)) {
  dbBackup = fs.readFileSync(dbPath, 'utf8');
}

// Function to make HTTP requests
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: TEST_PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main runner
async function run() {
  console.log('Starting integration tests...');
  
  // 1. Spin up server on port 3001 by passing PORT environment variable (or modifying server.js temporarily, but server.js is hardcoded to 3000. Wait!)
  // Oh, server.js has `const PORT = 3000;`. We can change it or just run on port 3000 since nothing is running there yet!
  // Wait, let's verify if port 3000 is open. Let's write verify_api.js to start on 3000 if not used, or we can temporarily change the PORT in server.js, or check if port 3000 works.
  // Actually, we can run it on port 3000.
  console.log('Starting server.js...');
  
  serverProcess = spawn('agy-node.cmd', ['server.js'], {
    shell: true,
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server Stdout]: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Stderr]: ${data.toString().trim()}`);
  });

  // Wait for server to start
  await delay(2000);

  // Overwrite TEST_PORT to 3000
  const PORT = 3000;
  
  function req3000(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: PORT,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        }
      };
      if (token) options.headers['Authorization'] = `Bearer ${token}`;
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => reject(err));
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  let passCount = 0;
  let testCount = 0;

  function assert(name, condition, msg = '') {
    testCount++;
    if (condition) {
      console.log(`[PASS] ${name}`);
      passCount++;
      return true;
    } else {
      console.error(`[FAIL] ${name}: ${msg}`);
      return false;
    }
  }

  try {
    // Test 1: Try login with incorrect password
    const resLoginFail = await req3000('POST', '/api/auth/login', { email: 'Tréner U19', password: 'wrongpassword' });
    assert('Login failure on bad password', resLoginFail.status === 401, `Expected 401, got ${resLoginFail.status}`);

    // Test 2: Try login with correct password
    const resLogin = await req3000('POST', '/api/auth/login', { email: 'Tréner U19', password: 'u19pwd' });
    assert('Login success on correct password', resLogin.status === 200 && resLogin.body.token, `Status: ${resLogin.status}`);
    const coachToken = resLogin.body.token;

    // Test 3: Get fields
    const resFields = await req3000('GET', '/api/fields', null, coachToken);
    assert('Get fields list', resFields.status === 200 && resFields.body.length === 14, `Status: ${resFields.status}, length: ${resFields.body.length}`);

    // Test 4: Create a reservation (Štvrtina A1, tomorrow 16:00-17:30)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const resCreate = await req3000('POST', '/api/reservations', {
      field_id: 'main_quarter_a1',
      start_time: `${dateStr}T16:00:00.000Z`,
      end_time: `${dateStr}T17:30:00.000Z`
    }, coachToken);
    assert('Create reservation', resCreate.status === 201, `Status: ${resCreate.status}, msg: ${resCreate.body.message}`);
    const resId = resCreate.body.id;

    // Test 5: Conflict check - Attempting to reserve parent (Polovica A) at overlapping time (16:30-18:00)
    const resConflict = await req3000('POST', '/api/reservations', {
      field_id: 'main_half_a',
      start_time: `${dateStr}T16:30:00.000Z`,
      end_time: `${dateStr}T18:00:00.000Z`
    }, coachToken);
    assert('Conflict detection blocks overlapping ancestor field', resConflict.status === 409, `Expected 409, got ${resConflict.status}, msg: ${JSON.stringify(resConflict.body)}`);

    // Test 6: Sibling check - Attempting to reserve sibling (Štvrtina A2) at overlapping time (16:00-17:30) - Should PASS!
    const resSibling = await req3000('POST', '/api/reservations', {
      field_id: 'main_quarter_a2',
      start_time: `${dateStr}T16:00:00.000Z`,
      end_time: `${dateStr}T17:30:00.000Z`
    }, coachToken);
    assert('No conflict for sibling fields', resSibling.status === 201, `Expected 201, got ${resSibling.status}, msg: ${JSON.stringify(resSibling.body)}`);

    // Test 7: Delete reservation
    const resDelete = await req3000('DELETE', `/api/reservations/${resId}`, null, coachToken);
    assert('Delete reservation', resDelete.status === 200, `Expected 200, got ${resDelete.status}`);

  } catch (err) {
    console.error('Test execution failed:', err);
  } finally {
    console.log('\nShutting down server...');
    if (serverProcess) {
      serverProcess.kill();
    }
    
    // Restore DB backup
    if (dbBackup) {
      fs.writeFileSync(dbPath, dbBackup, 'utf8');
      console.log('Database restored to backup state.');
    }

    console.log(`\nIntegration tests complete: ${passCount} / ${testCount} assertions passed.`);
    if (passCount === testCount) {
      console.log('ALL INTEGRATION TESTS PASSED!');
      process.exit(0);
    } else {
      console.error('SOME INTEGRATION TESTS FAILED!');
      process.exit(1);
    }
  }
}

run();
