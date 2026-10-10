class Processor {
  constructor(db, validator) {
    this.db = db;
    this.validator = validator;

    // Снапшот последних валидных значений
    this.snapshot = new Map();

    // Объекты для архивации
    this.allObjects = db.prepare(
      'SELECT source_id, object_name, data_type, is_trend FROM object_metadata'
    ).all();

    // Чуть заполняет снапшот пустыми значениями
    for (const o of this.allObjects) {
      this.snapshot.set(o.source_id + ':' + o.object_name, {
        value: null,
        type: o.data_type,
        isTrend: o.is_trend
      });
    }

    this.insertInvalid = db.prepare(
      'INSERT INTO invalid_log (ts, source_id, object_name, raw_value, reason) VALUES (?, ?, ?, ?, ?)'
    );
    this.insertPending = db.prepare(
      'INSERT INTO pending_writes (ts, payload, created_at) VALUES (?, ?, ?)'
    );
    this.markCommitted = db.prepare(
      "UPDATE pending_writes SET status='committed' WHERE id = ?"
    );
    this.insertArchive = db.prepare(
      'INSERT INTO archive (ts, source_id, object_name, value_text, value_type, is_trend) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.upsertTrend = db.prepare(
      'INSERT OR REPLACE INTO trend_window (trend_name, slot, value_text, ts) VALUES (?, ?, ?, ?)'
    );
  }

  handleCycle(snapshot) {
    const now = Math.floor(Date.now() / 1000);
    const invalid = [];
    const trends = [];

    // Применяем изменения к снапшоту
    for (const [sourceId, objects] of Object.entries(snapshot)) {
      for (const [name, value] of Object.entries(objects)) {
        const r = this.validator.validate(Number(sourceId), name, value);

        if (r.valid) {
          // Обновляем снапшот валидным значением
          const key = sourceId + ':' + name;
          this.snapshot.set(key, {
            value: String(r.value),
            type: r.type,
            isTrend: r.is_trend
          });
        } else {
          // Невалидное только в лог, снапшот не трогаем
          invalid.push({
            sourceId: Number(sourceId),
            name,
            rawValue: String(value),
            reason: r.reason
          });
        }
      }
    }

    // Вписываеми невалид в лог
    if (invalid.length > 0) {
      const logTx = this.db.transaction(() => {
        for (const it of invalid) {
          this.insertInvalid.run(now, it.sourceId, it.name, it.rawValue, it.reason);
        }
      });
      logTx();
    }

    // Собираем архивный батч, все 4000 объектов
    const archiveRows = [];
    for (const o of this.allObjects) {
      const key = o.source_id + ':' + o.object_name;
      const snap = this.snapshot.get(key);
      archiveRows.push({
        sourceId: o.source_id,
        name: o.object_name,
        value: snap.value,           // Может быть null, если ни разу не приходило валидное
        type: o.data_type,
        isTrend: o.is_trend ? 1 : 0
      });
      if (o.is_trend) {
        trends.push({
          name: o.object_name,
          value: snap.value,
          type: o.data_type
        });
      }
    }

    // Пишем намерение в WAL
    const batch = { ts: now, valid: archiveRows, trends };
    const intentId = this.insertPending.run(now, JSON.stringify(batch), now).lastInsertRowid;

    try {
      const tx = this.db.transaction(() => {
        for (const it of archiveRows) {
          this.insertArchive.run(now, it.sourceId, it.name, it.value === null ? 'null' : it.value, it.type, it.isTrend);
        }
        for (const t of trends) {
          // null значения в окно тренда не пишем, там должны быть только реальные данные
          if (t.value !== null) {
            this.upsertTrend.run(t.name, now % 3600, t.value, now);
          }
        }
        this.markCommitted.run(intentId);
      });
      tx();
    } catch (err) {
      console.error('Write failed, intent kept:', intentId, err);
    }

    console.log(
      '[tick ' + now + '] archived: ' + archiveRows.length +
      ', invalid: ' + invalid.length +
      ', trends updated: ' + trends.filter(t => t.value !== null).length
    );
  }
}

module.exports = { Processor };