// Нагрузочный тест - проверяем, что система держит нагрузку.
// Запуск: node tests/loadtest.js [секунды] [объектов на источник]
// Пример: node tests/loadtest.js 30 1000
//
// Работает с отдельной базой data/loadtest.db, не трогает рабочую.

const fs = require('fs');
const path = require('path');

// Параметры из аргументов командной строки
const DURATION = Number(process.argv[2]) || 30;
const OBJECTS_PER_SOURCE = Number(process.argv[3]) || 1000;

// Путь к тестовой базе
const TEST_DB = path.join(__dirname, '..', 'data', 'loadtest.db');

// Удаляем старую тестовую базу
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');

// Подключаем модули
const { initDb } = require('../src/db');
const { ObjectValidator } = require('../src/validator');
const { Processor } = require('../src/processor');

console.log('=== НАГРУЗОЧНЫЙ ТЕСТ ===');
console.log('Длительность:         ' + DURATION + ' сек');
console.log('Объектов на источник: ' + OBJECTS_PER_SOURCE);
console.log('Источников:           4');
console.log('Всего объектов:       ' + OBJECTS_PER_SOURCE * 4);
console.log('');

// Создаём тестовую базу
const db = initDb(TEST_DB);

// Готовим запрос для добавления объектов
const insertMeta = db.prepare(`
  INSERT INTO object_metadata (source_id, object_name, data_type, business_rule, is_trend)
  VALUES (?, ?, ?, ?, ?)
`);

console.log('Заполняем object_metadata...');

// Заполняем объекты в одной транзакции (так быстрее)
const fillTx = db.transaction(() => {
  for (const sid of [1, 2, 3, 4]) {
    for (let i = 1; i <= OBJECTS_PER_SOURCE; i++) {
      const name = 'src' + sid + '_obj' + String(i).padStart(4, '0');
      // В источнике 1 первые 20 объектов - это тренды
      const isTrend = sid === 1 && i <= 20 ? 1 : 0;
      // У первых пяти трендов есть бизнес-правило min: 500
      const rule = isTrend && i <= 5 ? JSON.stringify({ min: 500 }) : null;
      insertMeta.run(sid, name, 'number', rule, isTrend);
    }
  }
});
fillTx();

// Сколько объектов в итоге
const total = db.prepare('SELECT COUNT(*) c FROM object_metadata').get().c;
console.log('Загружено объектов: ' + total);
console.log('');

// Создаём валидатор и обработчик
const validator = new ObjectValidator(db);
const processor = new Processor(db, validator);

// Генерируем один цикл нагрузки: 100-600 изменений на источник
function makeTick() {
  const batch = {};
  for (const sid of [1, 2, 3, 4]) {
    batch[sid] = {};
    // Сколько объектов менять в этот раз
    const changeCount = Math.floor(Math.random() * 500) + 100;

    for (let i = 0; i < changeCount; i++) {
      // Выбираем случайный объект
      const idx = Math.floor(Math.random() * OBJECTS_PER_SOURCE) + 1;
      const name = 'src' + sid + '_obj' + String(idx).padStart(4, '0');

      // Иногда шлём невалидное значение - чтобы проверить лог
      const roll = Math.random();
      let value;
      if (roll < 0.03) {
        value = 'abc';                          // 3% - неправильный тип
      } else if (roll < 0.05) {
        value = 100;                            // 2% - может не пройти min:500
      } else {
        value = Math.floor(Math.random() * 10000); // обычное число
      }
      batch[sid][name] = value;
    }
  }
  return batch;
}

// Массивы для статистики
const cycleTimes = [];
let archiveBefore = db.prepare('SELECT COUNT(*) c FROM archive').get().c;
let invalidBefore = db.prepare('SELECT COUNT(*) c FROM invalid_log').get().c;

let ticks = 0;
const startWall = Date.now();

console.log('Старт нагрузки на ' + DURATION + ' секунд...\n');
console.log('сек | цикл(мс) | архив+  | invalid+ | размер БД');
console.log('----+----------+---------+----------+-----------');

// Узнаём размер файла базы
function dbSize() {
  try {
    return fs.statSync(TEST_DB).size;
  } catch (e) {
    return 0;
  }
}

// Красиво показываем размер файла
function human(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// Запускаем циклы каждую секунду
const interval = setInterval(() => {
  const t0 = Date.now();

  // Обрабатываем один цикл
  const batch = makeTick();
  processor.handleCycle(batch);

  const dt = Date.now() - t0;
  cycleTimes.push(dt);
  ticks++;

  // Считаем, сколько добавилось за этот цикл
  const aNow = db.prepare('SELECT COUNT(*) c FROM archive').get().c;
  const iNow = db.prepare('SELECT COUNT(*) c FROM invalid_log').get().c;
  const archiveDelta = aNow - archiveBefore;
  const invalidDelta = iNow - invalidBefore;
  archiveBefore = aNow;
  invalidBefore = iNow;

  // Печатаем строку прогресса
  console.log(
    String(ticks).padStart(3) + ' | ' +
    String(dt).padStart(8) + ' | ' +
    String(archiveDelta).padStart(7) + ' | ' +
    String(invalidDelta).padStart(8) + ' | ' +
    human(dbSize())
  );

  // Если отработали нужное количество секунд - завершаем
  if (ticks >= DURATION) {
    clearInterval(interval);
    finish();
  }
}, 1000);

// Финальный отчёт
function finish() {
  const elapsed = (Date.now() - startWall) / 1000;

  // Собираем финальную статистику
  const totalArchive = db.prepare('SELECT COUNT(*) c FROM archive').get().c;
  const totalInvalid = db.prepare('SELECT COUNT(*) c FROM invalid_log').get().c;
  const totalTrend = db.prepare('SELECT COUNT(*) c FROM trend_window').get().c;
  const pendingPending = db.prepare(
    "SELECT COUNT(*) c FROM pending_writes WHERE status='pending'"
  ).get().c;

  // Считаем статистику по времени цикла
  const avg = cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
  const max = Math.max(...cycleTimes);
  const min = Math.min(...cycleTimes);
  const sorted = cycleTimes.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  // Проверяем, не деградирует ли система со временем
  const half = Math.floor(cycleTimes.length / 2);
  const firstHalf = cycleTimes.slice(0, half);
  const secondHalf = cycleTimes.slice(half);
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const degradation = ((avgSecond - avgFirst) / avgFirst) * 100;

  console.log('\n================ РЕЗУЛЬТАТ ================');
  console.log('Время работы:           ' + elapsed.toFixed(1) + ' сек');
  console.log('Всего тиков:            ' + ticks);
  console.log('');
  console.log('Записано в archive:     ' + totalArchive);
  console.log('Записано в invalid_log: ' + totalInvalid);
  console.log('Записей в trend_window: ' + totalTrend);
  console.log('Pending (не завершены): ' + pendingPending);
  console.log('');
  console.log('Время цикла (мс):');
  console.log('  минимум:  ' + min);
  console.log('  медиана:  ' + median);
  console.log('  среднее:  ' + avg.toFixed(1));
  console.log('  95-й %:   ' + p95);
  console.log('  максимум: ' + max);
  console.log('');
  console.log('Деградация (2-я половина vs 1-я): ' + degradation.toFixed(1) + '%');
  console.log('Размер БД:              ' + human(dbSize()));
  console.log('===========================================');

  // Проверки, что всё в норме
  const checks = [
    ['Среднее время цикла < 1000 мс', avg < 1000],
    ['Максимум времени цикла < 1000 мс', max < 1000],
    ['Деградация < 50%', degradation < 50],
    ['Архив получил данные', totalArchive > 0],
    ['Invalid-лог получил данные', totalInvalid > 0],
    ['Trend_window получил данные', totalTrend > 0],
    ['Нет незавершённых pending-записей', pendingPending === 0]
  ];

  console.log('\nПРОВЕРКИ:');
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log('  ' + (ok ? 'OK  ' : 'FAIL') + ' ' + name);
    if (!ok) allOk = false;
  }

  // Закрываем и удаляем тестовую базу
  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');

  console.log('\n' + (allOk ? 'ВСЁ ОК' : 'ЕСТЬ ПРОБЛЕМЫ'));
  process.exit(allOk ? 0 : 1);
}