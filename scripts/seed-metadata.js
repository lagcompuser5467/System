const { initDb } = require('../src/db');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const db = initDb(path.join(__dirname, '..', 'data', 'param.db'));

const trendSet = new Set(config.trends.map(t => t.source + ':' + t.name));

const insert = db.prepare('INSERT OR REPLACE INTO object_metadata (source_id, object_name, data_type, business_rule, is_trend) VALUES (?, ?, ?, ?, ?)');

const tx = db.transaction(() => {
  for (const sid of config.sources) {
    for (const obj of config.objects[sid]) {
      const isTrend = trendSet.has(sid + ':' + obj.name) ? 1 : 0;
      const rule = obj.business_rule ? JSON.stringify(obj.business_rule) : null;
      insert.run(sid, obj.name, obj.type, rule, isTrend);
    }
  }
});
tx();

const cnt = db.prepare('SELECT COUNT(*) c FROM object_metadata').get();
console.log('object_metadata filled. Total:', cnt.c);
