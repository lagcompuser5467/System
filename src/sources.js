const fs = require('fs');
const path = require('path');

function loadConfig() {
  const p = path.join(__dirname, '..', 'config.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function makeSource(sourceId, config) {
  const state = new Map();
  const objects = config.objects[String(sourceId)] || [];
  const metaByName = new Map();
  for (const obj of objects) metaByName.set(obj.name, obj);
  for (const obj of objects) state.set(obj.name, obj.type === 'number' ? 0 : false);

  return {
    id: sourceId,
    tick() {
      const changeCount = randInt(100, 600);
      const names = [...state.keys()];
      const changed = {};
      for (let i = 0; i < changeCount; i++) {
        const name = names[randInt(0, names.length - 1)];
        const obj = metaByName.get(name);
        let newVal;
        if (obj.type === 'number') {
          newVal = randInt(obj.min || 0, obj.max || 10000);
          if (Math.random() < 0.05) newVal = 'abc';
        } else {
          newVal = Math.random() < 0.5;
          if (Math.random() < 0.05) newVal = 'not_bool';
        }
        state.set(name, newVal);
        changed[name] = newVal;
      }
      return changed;
    }
  };
}

function startSources(processor) {
  const config = loadConfig();
  const sources = [1, 2, 3, 4].map(id => makeSource(id, config));

  setInterval(() => {
    const snapshot = {};
    for (const s of sources) snapshot[s.id] = s.tick();
    processor.handleCycle(snapshot);
  }, 1000);

  console.log('Sources started (4)');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { startSources, loadConfig };
