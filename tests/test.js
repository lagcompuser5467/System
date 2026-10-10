// Простые тесты для проверки, что всё работает.
// Запуск: node tests/test.js
//
// Тесты создают отдельную базу data/test.db и в конце её удаляют.
// Рабочую базу data/param.db они не трогают.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Путь к тестовой базе
const TEST_DB = path.join(__dirname, '..', 'data', 'test.db');

// Если база от прошлого запуска осталась - удаляем
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');

// Подключаем модули из src
const { initDb } = require('../src/db');
const { ObjectValidator } = require('../src/validator');
const { Processor } = require('../src/processor');

// Счётчики для итога
let passed = 0;
let failed = 0;

// Простая функция для запуска одного теста
function test(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    passed++;
  } catch (err) {
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
    failed++;
  }
}

// Создаём тестовую базу
const db = initDb(TEST_DB);

// Добавляем несколько объектов, чтобы было на чём тестировать
const insertMeta = db.prepare(`
  INSERT INTO object_metadata (source_id, object_name, data_type, business_rule, is_trend)
  VALUES (?, ?, ?, ?, ?)
`);
insertMeta.run(1, 'num_ok', 'number', null, 0);
insertMeta.run(1, 'num_min500', 'number', JSON.stringify({ min: 500 }), 1);
insertMeta.run(1, 'bool_ok', 'boolean', null, 0);
insertMeta.run(2, 'num_source2', 'number', null, 0);

// Создаём валидатор и обработчик
const validator = new ObjectValidator(db);
const processor = new Processor(db, validator);

// ============================================================
console.log('\n[1] Проверка типов данных');
// ============================================================

// Число для числового объекта - должно пройти
test('число принимается для number', () => {
  const r = validator.validate(1, 'num_ok', 42);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.value, 42);
  assert.strictEqual(r.type, 'number');
});

// Строка "abc" для числового объекта - должно отклонить
test('строка "abc" отклоняется для number', () => {
  const r = validator.validate(1, 'num_ok', 'abc');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'type_mismatch');
});

// true для булева объекта - должно пройти
test('true принимается для boolean', () => {
  const r = validator.validate(1, 'bool_ok', true);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.value, true);
});

// Строка "1" должна превратиться в true
test('строка "1" приводится к true для boolean', () => {
  const r = validator.validate(1, 'bool_ok', '1');
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.value, true);
});

// Строка "not_bool" не должна пройти для булева
test('строка "not_bool" отклоняется для boolean', () => {
  const r = validator.validate(1, 'bool_ok', 'not_bool');
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'type_mismatch');
});

// ============================================================
console.log('\n[2] Проверка бизнес-правил');
// ============================================================

// 600 больше 500 - правило выполнено
test('значение 600 проходит правило min:500', () => {
  const r = validator.validate(1, 'num_min500', 600);
  assert.strictEqual(r.valid, true);
});

// 400 меньше 500 - правило не выполнено
test('значение 400 не проходит правило min:500', () => {
  const r = validator.validate(1, 'num_min500', 400);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'business_rule');
});

// Ровно 500 - граница, должно пройти
test('значение ровно 500 проходит (граница)', () => {
  const r = validator.validate(1, 'num_min500', 500);
  assert.strictEqual(r.valid, true);
});

// Проверяем, что тренд помечается как тренд
test('тренд помечается isTrend = 1', () => {
  const r = validator.validate(1, 'num_min500', 600);
  assert.strictEqual(r.isTrend, 1);
});

// ============================================================
console.log('\n[3] Проверка неизвестных объектов');
// ============================================================

// Объекта нет в метаданных - должно отклонить
test('неизвестный объект отклоняется', () => {
  const r = validator.validate(1, 'no_such_object', 42);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'unknown_object');
});

// Объект есть, но в другом источнике - тоже должно отклонить
test('объект из другого источника не найден', () => {
  const r = validator.validate(3, 'num_ok', 42);
  assert.strictEqual(r.valid, false);
  assert.strictEqual(r.reason, 'unknown_object');
});

// Объект из правильного источника - должен пройти
test('объект из правильного источника найден', () => {
  const r = validator.validate(2, 'num_source2', 42);
  assert.strictEqual(r.valid, true);
});

// ============================================================
console.log('\n[4] Проверка схемы базы данных');
// ============================================================

// Проверяем, что все нужные таблицы созданы
test('таблица object_metadata существует', () => {
  const r = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='object_metadata'"
  ).get();
  assert.ok(r);
});

test('таблица archive существует', () => {
  const r = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='archive'"
  ).get();
  assert.ok(r);
});

test('таблица trend_window существует', () => {
  const r = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trend_window'"
  ).get();
  assert.ok(r);
});

test('таблица invalid_log существует', () => {
  const r = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='invalid_log'"
  ).get();
  assert.ok(r);
});

test('таблица pending_writes существует', () => {
  const r = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_writes'"
  ).get();
  assert.ok(r);
});

// Проверяем, что включён режим WAL
test('WAL-режим включён', () => {
  const mode = db.pragma('journal_mode', { simple: true });
  assert.strictEqual(mode, 'wal');
});

// ============================================================
console.log('\n[5] Проверка обработчика - один цикл');
// ============================================================

// После цикла все 4 объекта должны попасть в архив
test('после цикла архив получил все 4 объекта', () => {
  const before = db.prepare('SELECT COUNT(*) c FROM archive').get().c;

  // Запускаем один цикл с данными
  processor.handleCycle({
    1: { num_ok: 100, num_min500: 600, bool_ok: true },
    2: { num_source2: 7 }
  });

  const after = db.prepare('SELECT COUNT(*) c FROM archive').get().c;
  assert.strictEqual(after - before, 4, 'должно добавиться ровно 4 записи');
});

// Невалидное значение должно попасть в лог, но не испортить архив
test('невалидное значение в логе, а не в архиве', () => {
  const beforeInvalid = db.prepare('SELECT COUNT(*) c FROM invalid_log').get().c;

  // Присылаем невалидное значение для числового объекта
  processor.handleCycle({
    1: { num_ok: 'abc' }
  });

  const afterInvalid = db.prepare('SELECT COUNT(*) c FROM invalid_log').get().c;
  assert.strictEqual(afterInvalid - beforeInvalid, 1);

  // Смотрим, что последнее значение в архиве для num_ok - не "abc"
  const lastNumOk = db.prepare(
    "SELECT value_text FROM archive WHERE object_name='num_ok' ORDER BY id DESC LIMIT 1"
  ).get();
  assert.notStrictEqual(lastNumOk.value_text, 'abc');
});

// Значение меньше 500 должно попасть в лог с причиной business_rule
test('бизнес-правило работает в обработчике', () => {
  const before = db.prepare(
    "SELECT COUNT(*) c FROM invalid_log WHERE reason='business_rule'"
  ).get().c;

  // 100 меньше 500 - невалидно
  processor.handleCycle({
    1: { num_min500: 100 }
  });

  const after = db.prepare(
    "SELECT COUNT(*) c FROM invalid_log WHERE reason='business_rule'"
  ).get().c;

  assert.ok(after > before);
});

// Тренд должен попасть в отдельную таблицу
test('тренд попал в trend_window', () => {
  const row = db.prepare(
    "SELECT * FROM trend_window WHERE trend_name='num_min500' LIMIT 1"
  ).get();
  assert.ok(row);
});

// ============================================================
console.log('\n[6] Проверка WAL и восстановления');
// ============================================================

// Симулируем сбой: оставляем pending-запись и проверяем, что она восстановится
test('pending-запись восстанавливается при старте', () => {
  const batch = {
    ts: Math.floor(Date.now() / 1000),
    valid: [
      { sourceId: 1, name: 'num_ok', value: '555', type: 'number', isTrend: 0 }
    ],
    trends: []
  };

  // Записываем "намерение" в журнал
  const intentId = db.prepare(
    'INSERT INTO pending_writes (ts, payload, created_at) VALUES (?, ?, ?)'
  ).run(batch.ts, JSON.stringify(batch), batch.ts).lastInsertRowid;

  const beforeArchive = db.prepare('SELECT COUNT(*) c FROM archive').get().c;

  // Восстанавливаем как при старте программы
  const pending = db.prepare("SELECT * FROM pending_writes WHERE status='pending'").all();
  for (const p of pending) {
    const b = JSON.parse(p.payload);
    const tx = db.transaction(() => {
      const insA = db.prepare(
        'INSERT INTO archive (ts, source_id, object_name, value_text, value_type, is_trend) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const it of b.valid) {
        // Защита от NULL - пишем строку 'null'
        const safeValue = it.value === null ? 'null' : it.value;
        insA.run(b.ts, it.sourceId, it.name, safeValue, it.type, it.isTrend);
      }
      const upT = db.prepare(
        'INSERT OR REPLACE INTO trend_window (trend_name, slot, value_text, ts) VALUES (?, ?, ?, ?)'
      );
      for (const t of b.trends) {
        if (t.value !== null) upT.run(t.name, b.ts % 3600, t.value, b.ts);
      }
      db.prepare("UPDATE pending_writes SET status='committed' WHERE id=?").run(p.id);
    });
    tx();
  }

  const afterArchive = db.prepare('SELECT COUNT(*) c FROM archive').get().c;
  assert.strictEqual(afterArchive - beforeArchive, 1);

  const status = db.prepare('SELECT status FROM pending_writes WHERE id=?').get(intentId).status;
  assert.strictEqual(status, 'committed');
});

// Проверяем, что строка 'null' спокойно вставляется (обход NOT NULL)
test('null-значение пишется как строка "null"', () => {
  let threw = false;
  try {
    db.prepare(
      'INSERT INTO archive (ts, source_id, object_name, value_text, value_type, is_trend) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(Math.floor(Date.now() / 1000), 1, 'num_ok', 'null', 'number', 0);
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false);
});

// ============================================================
console.log('\n[7] Проверка производительности');
// ============================================================

// Один цикл не должен занимать больше секунды
test('один цикл обработки укладывается в 1000 мс', () => {
  const bigBatch = { 1: {}, 2: {} };
  for (let i = 0; i < 200; i++) {
    bigBatch[1]['num_ok'] = i;
    bigBatch[1]['bool_ok'] = i % 2 === 0;
    bigBatch[1]['num_min500'] = 500 + i;
    bigBatch[2]['num_source2'] = i;
  }

  const t0 = Date.now();
  processor.handleCycle(bigBatch);
  const dt = Date.now() - t0;

  console.log('       цикл занял ' + dt + ' мс');
  assert.ok(dt < 1000);
});

// ============================================================
// Итог
// ============================================================
console.log('\n----------------------------------------');
console.log('Пройдено: ' + passed);
console.log('Провалено: ' + failed);
console.log('----------------------------------------');

// Закрываем базу и удаляем тестовый файл
db.close();
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');

// Если были провалы - код возврата 1, иначе 0
process.exit(failed === 0 ? 0 : 1);