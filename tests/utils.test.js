/**
 * Basic Tests — Plataforma PFO
 *
 * Lightweight test runner (no framework dependency).
 * Run with: node tests/utils.test.js
 */

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    errors.push({ name, error: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected "${expected}", got "${actual}"`);
  }
}

// =====================================================================
// Import modules (using dynamic import for ESM)
// =====================================================================

async function runTests() {
  console.log('\n📋 Plataforma PFO — Test Suite\n');

  // ---------- format.js tests ----------
  console.log('utils/format.js:');

  const format = await import('../assets/js/utils/format.js');

  test('safeNumber: valid number', () => {
    assertEqual(format.safeNumber('42.5'), 42.5);
  });

  test('safeNumber: null returns 0', () => {
    assertEqual(format.safeNumber(null), 0);
  });

  test('safeNumber: undefined returns 0', () => {
    assertEqual(format.safeNumber(undefined), 0);
  });

  test('safeNumber: NaN string returns 0', () => {
    assertEqual(format.safeNumber('abc'), 0);
  });

  test('safeNumber: empty string returns 0', () => {
    assertEqual(format.safeNumber(''), 0);
  });

  test('formatNumber: large value shows M suffix', () => {
    assertEqual(format.formatNumber(1500), '1.5M');
  });

  test('formatNumber: NaN returns dash', () => {
    assertEqual(format.formatNumber(NaN), '—');
  });

  test('formatNumber: null returns dash', () => {
    assertEqual(format.formatNumber(null), '—');
  });

  test('formatMonth: valid month', () => {
    assertEqual(format.formatMonth('2024-03'), 'Mar/2024');
  });

  test('formatMonth: december', () => {
    assertEqual(format.formatMonth('2024-12'), 'Dez/2024');
  });

  test('formatMonth: null returns dash', () => {
    assertEqual(format.formatMonth(null), '—');
  });

  test('formatMonth: empty returns dash', () => {
    assertEqual(format.formatMonth(''), '—');
  });

  test('getCurrentMonth: returns YYYY-MM format', () => {
    const result = format.getCurrentMonth();
    assert(/^\d{4}-\d{2}$/.test(result), `Invalid format: ${result}`);
  });

  test('formatPercent: normal value', () => {
    assertEqual(format.formatPercent(42.567), '42.6%');
  });

  test('formatPercent: with decimals', () => {
    assertEqual(format.formatPercent(42.567, 2), '42.57%');
  });

  test('formatPercent: null returns dash', () => {
    assertEqual(format.formatPercent(null), '—');
  });

  test('truncate: short string unchanged', () => {
    assertEqual(format.truncate('hello', 10), 'hello');
  });

  test('truncate: long string truncated', () => {
    assertEqual(format.truncate('hello world test', 10), 'hello worl...');
  });

  test('truncate: null returns dash', () => {
    assertEqual(format.truncate(null), '—');
  });

  test('marginColor: negative returns red', () => {
    assertEqual(format.marginColor(-5), 'var(--red)');
  });

  test('marginColor: low returns amber', () => {
    assertEqual(format.marginColor(3), 'var(--amber)');
  });

  test('marginColor: healthy returns green', () => {
    assertEqual(format.marginColor(10), 'var(--green)');
  });

  test('percent: normal calculation', () => {
    assertEqual(format.percent(25, 100), 25);
  });

  test('percent: zero total returns 0', () => {
    assertEqual(format.percent(25, 0), 0);
  });

  // ---------- shared.js tests ----------
  console.log('\npages/shared.js:');

  const shared = await import('../assets/js/pages/shared.js');

  test('getStatus: aprovado', () => {
    const pfo = { arquivo: 'PFO_TEST.xlsx' };
    const apr = { PFO_TEST: { status: 'aprovado' } };
    assertEqual(shared.getStatus(pfo, apr), 'aprovado');
  });

  test('getStatus: reprovado', () => {
    const pfo = { arquivo: 'PFO_TEST.xlsx' };
    const apr = { PFO_TEST: { status: 'reprovado' } };
    assertEqual(shared.getStatus(pfo, apr), 'reprovado');
  });

  test('getStatus: aguardando -> enviado', () => {
    const pfo = { arquivo: 'PFO_TEST.xlsx' };
    const apr = { PFO_TEST: { status: 'aguardando_validacao' } };
    assertEqual(shared.getStatus(pfo, apr), 'enviado');
  });

  test('getStatus: has arquivo but no approval -> enviado', () => {
    const pfo = { arquivo: 'PFO_TEST.xlsx' };
    assertEqual(shared.getStatus(pfo, {}), 'enviado');
  });

  test('getStatus: no arquivo -> pendente', () => {
    const pfo = {};
    assertEqual(shared.getStatus(pfo, {}), 'pendente');
  });

  test('getStatus: xlsm extension handled', () => {
    const pfo = { arquivo: 'PFO_TEST.xlsm' };
    const apr = { PFO_TEST: { status: 'aprovado' } };
    assertEqual(shared.getStatus(pfo, apr), 'aprovado');
  });

  test('STREAMLIT_URL: is defined', () => {
    assert(shared.STREAMLIT_URL && shared.STREAMLIT_URL.includes('streamlit.app'));
  });

  // ---------- Summary ----------
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (errors.length) {
    console.log('\nFailed tests:');
    errors.forEach((e) => console.log(`  - ${e.name}: ${e.error}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
