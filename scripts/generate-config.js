const fs = require('fs');
const path = require('path');

const SOURCES = [1, 2, 3, 4];
const OBJECTS_PER_SOURCE = 1000;
const TREND_COUNT = 20;

const trendNames = [];
for (let i = 1; i <= TREND_COUNT; i++) {
  trendNames.push('trend_' + String(i).padStart(2, '0'));
}

const objects = {};

for (const sid of SOURCES) {
  objects[sid] = [];
  for (let i = 1; i <= OBJECTS_PER_SOURCE; i++) {
    const name = 'src' + sid + '_obj' + String(i).padStart(4, '0');
    const isNum = Math.random() < 0.7;
    const obj = { name, type: isNum ? 'number' : 'boolean' };
    if (isNum) { obj.min = 0; obj.max = 10000; }
    objects[sid].push(obj);
  }
}

const businessRules = {};
const trends = [];

for (let i = 0; i < TREND_COUNT; i++) {
  const sourceObj = objects[1][i];
  trends.push({ name: sourceObj.name, source: 1, displayName: trendNames[i] });
  sourceObj.is_trend = 1;
  if (i < 5) {
    businessRules[sourceObj.name] = { min: 500 };
    sourceObj.business_rule = { min: 500 };
  }
}

const config = { sources: SOURCES, objects, trends, businessRules };

const out = path.join(__dirname, '..', 'config.json');
fs.writeFileSync(out, JSON.stringify(config, null, 2), 'utf8');
console.log('config.json created');
console.log('Sources:', SOURCES.length, '| Objects per source:', OBJECTS_PER_SOURCE, '| Trends:', TREND_COUNT);
