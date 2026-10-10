const { initDb } = require('./db');
const { ObjectValidator } = require('./validator');
const { startSources } = require('./sources');
const { Processor } = require('./processor');
const { startServer } = require('./server');

async function main() {
  const db = initDb('./data/param.db');

  // Восстановление незавершённых намерений
  const pending = db.prepare("SELECT * FROM pending_writes WHERE status='pending'").all();
  if (pending.length > 0) {
    console.log('Recovering', pending.length, 'pending intents');
    for (const p of pending) {
      const batch = JSON.parse(p.payload);
      const tx = db.transaction(() => {
        const insA = db.prepare('INSERT INTO archive (ts, source_id, object_name, value_text, value_type, is_trend) VALUES (?, ?, ?, ?, ?, ?)');
        for (const it of batch.valid) insA.run(batch.ts, it.sourceId, it.name, it.value, it.type, it.isTrend);
        const upT = db.prepare('INSERT OR REPLACE INTO trend_window (trend_name, slot, value_text, ts) VALUES (?, ?, ?, ?)');
        for (const t of batch.trends) upT.run(t.name, batch.ts % 3600, t.value, batch.ts);
        db.prepare("UPDATE pending_writes SET status='committed' WHERE id=?").run(p.id);
      });
      tx();
    }
  }

  const validator = new ObjectValidator(db);
  const processor = new Processor(db, validator);

  startSources(processor);
  startServer(db, 3000);
  console.log('System started. Try http://localhost:3000/api/requirements');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
