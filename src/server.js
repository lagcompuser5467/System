const http = require('http');
const url = require('url');

function startServer(db, port) {
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      if (parsed.pathname === '/api/requirements') {
        const rows = db.prepare('SELECT source_id, object_name, data_type, business_rule, is_trend FROM object_metadata').all();
        return res.end(JSON.stringify(rows, null, 2));
      }

      if (parsed.pathname === '/api/archive') {
        const { object, from, to, source } = parsed.query;
        let sql = 'SELECT ts, object_name, value_text, value_type FROM archive WHERE ts BETWEEN ? AND ?';
        const params = [Number(from || 0), Number(to || Math.floor(Date.now() / 1000))];
        if (object) { sql += ' AND object_name = ?'; params.push(object); }
        if (source) { sql += ' AND source_id = ?'; params.push(Number(source)); }
        sql += ' ORDER BY ts ASC LIMIT 3600';
        const rows = db.prepare(sql).all(...params);
        return res.end(JSON.stringify(rows, null, 2));
      }

      if (parsed.pathname === '/api/trends') {
        const name = parsed.query.name;
        if (!name) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'need name' })); }
        const rows = db.prepare('SELECT slot, value_text, ts FROM trend_window WHERE trend_name = ? ORDER BY ts DESC LIMIT 3600').all(name);
        return res.end(JSON.stringify(rows, null, 2));
      }

      if (parsed.pathname === '/api/invalid') {
        const rows = db.prepare('SELECT * FROM invalid_log ORDER BY ts DESC LIMIT 100').all();
        return res.end(JSON.stringify(rows, null, 2));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, () => {
    console.log('HTTP API on http://localhost:' + port);
  });

  return server;
}

module.exports = { startServer };
