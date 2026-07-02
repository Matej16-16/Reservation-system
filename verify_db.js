const fs = require('fs');
const path = require('path');

// Load DB
const dbPath = path.join(__dirname, 'db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

// Build fields map for easy parent lookup
const fieldsMap = {};
db.fields.forEach(f => {
  fieldsMap[f.id] = f;
});

/**
 * Checks if field1 and field2 are conflicting in the hierarchy.
 * They conflict if:
 * 1. They are the same field.
 * 2. field1 is an ancestor of field2.
 * 3. field1 is a descendant of field2.
 */
function areFieldsConflicting(fieldId1, fieldId2) {
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

/**
 * Checks if two time intervals overlap.
 * Intervals are [start1, end1) and [start2, end2).
 */
function areTimesOverlapping(start1, end1, start2, end2) {
  const s1 = new Date(start1).getTime();
  const e1 = new Date(end1).getTime();
  const s2 = new Date(start2).getTime();
  const e2 = new Date(end2).getTime();

  return s1 < e2 && e1 > s2;
}

/**
 * Check if a proposed reservation conflicts with any existing reservations
 */
function checkConflict(newRes, reservations) {
  for (const existing of reservations) {
    // If it's the same reservation (updating), skip
    if (newRes.id && existing.id === newRes.id) continue;

    if (areTimesOverlapping(newRes.start_time, newRes.end_time, existing.start_time, existing.end_time)) {
      if (areFieldsConflicting(newRes.field_id, existing.field_id)) {
        return existing; // Return the conflicting reservation
      }
    }
  }
  return null;
}

// ==========================================
// TEST CASES
// ==========================================
console.log('Running Conflict Logic Verification Tests...');

const assertions = [
  // 1. Same field hierarchy overlap tests
  { f1: 'main_quarter_a1', f2: 'main_half_a', expectedConflict: true, desc: 'Quarter A1 vs Half A' },
  { f1: 'main_quarter_a1', f2: 'main_full', expectedConflict: true, desc: 'Quarter A1 vs Full Main Field' },
  { f1: 'main_quarter_a1', f2: 'main_quarter_a1', expectedConflict: true, desc: 'Quarter A1 vs itself' },
  // Sibling and other branches - should not overlap
  { f1: 'main_quarter_a1', f2: 'main_quarter_a2', expectedConflict: false, desc: 'Quarter A1 vs Quarter A2 (siblings)' },
  { f1: 'main_quarter_a1', f2: 'main_half_b', expectedConflict: false, desc: 'Quarter A1 vs Half B (different halves)' },
  { f1: 'main_quarter_a1', f2: 'training_quarter_a1', expectedConflict: false, desc: 'Quarter A1 vs Training Pitch Quarter A1 (different main trees)' },
  { f1: 'main_half_a', f2: 'main_half_b', expectedConflict: false, desc: 'Half A vs Half B' },
  { f1: 'main_full', f2: 'training_full', expectedConflict: false, desc: 'Full Main vs Full Training' },
  { f1: 'training_quarter_a1', f2: 'training_half_a', expectedConflict: true, desc: 'Training Quarter A1 vs Training Half A' },
  { f1: 'training_half_a', f2: 'training_half_b', expectedConflict: false, desc: 'Training Half A vs Training Half B' },
];

let passCount = 0;
assertions.forEach((test, idx) => {
  const result = areFieldsConflicting(test.f1, test.f2);
  if (result === test.expectedConflict) {
    console.log(`[PASS] Test ${idx + 1}: ${test.desc}`);
    passCount++;
  } else {
    console.error(`[FAIL] Test ${idx + 1}: ${test.desc}. Expected ${test.expectedConflict}, got ${result}`);
  }
});

console.log('\nTesting time overlaps...');
const timeTests = [
  { s1: '2026-06-24T14:00:00Z', e1: '2026-06-24T15:00:00Z', s2: '2026-06-24T15:00:00Z', e2: '2026-06-24T16:00:00Z', expected: false, desc: 'Adjacent hours' },
  { s1: '2026-06-24T14:00:00Z', e1: '2026-06-24T15:00:00Z', s2: '2026-06-24T14:30:00Z', e2: '2026-06-24T15:30:00Z', expected: true, desc: 'Partial overlap' },
  { s1: '2026-06-24T14:00:00Z', e1: '2026-06-24T15:00:00Z', s2: '2026-06-24T13:00:00Z', e2: '2026-06-24T14:30:00Z', expected: true, desc: 'Partial overlap start' },
  { s1: '2026-06-24T14:00:00Z', e1: '2026-06-24T15:00:00Z', s2: '2026-06-24T14:15:00Z', e2: '2026-06-24T14:45:00Z', expected: true, desc: 'Fully inside' },
  { s1: '2026-06-24T14:00:00Z', e1: '2026-06-24T15:00:00Z', s2: '2026-06-24T13:00:00Z', e2: '2026-06-24T16:00:00Z', expected: true, desc: 'Fully surrounding' }
];

timeTests.forEach((test, idx) => {
  const result = areTimesOverlapping(test.s1, test.e1, test.s2, test.e2);
  if (result === test.expected) {
    console.log(`[PASS] Time Test ${idx + 1}: ${test.desc}`);
    passCount++;
  } else {
    console.error(`[FAIL] Time Test ${idx + 1}: ${test.desc}. Expected ${test.expected}, got ${result}`);
  }
});

const totalTests = assertions.length + timeTests.length;
console.log(`\nTest summary: ${passCount} / ${totalTests} passed.`);

if (passCount === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('SOME TESTS FAILED!');
  process.exit(1);
}
