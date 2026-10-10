class ObjectValidator {
  constructor(db) {
    this.metadata = new Map();
    const rows = db.prepare('SELECT * FROM object_metadata').all();
    for (const r of rows) {
      this.metadata.set(r.source_id + ':' + r.object_name, r);
    }
    console.log('Loaded metadata:', this.metadata.size);
  }

  validate(sourceId, objectName, rawValue) {
    const meta = this.metadata.get(sourceId + ':' + objectName);
    if (!meta) return { valid: false, reason: 'unknown_object' };

    const parsed = this.parseValue(rawValue, meta.data_type);
    if (parsed === null) return { valid: false, reason: 'type_mismatch' };

    if (meta.business_rule) {
      const rule = JSON.parse(meta.business_rule);
      if (rule.min !== undefined && parsed < rule.min) {
        return { valid: false, reason: 'business_rule' };
      }
      if (rule.max !== undefined && parsed > rule.max) {
        return { valid: false, reason: 'business_rule' };
      }
    }

    return { valid: true, value: parsed, type: meta.data_type, isTrend: meta.is_trend };
  }

  parseValue(raw, type) {
    if (type === 'boolean') {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === '1') return true;
      if (raw === 'false' || raw === '0') return false;
      return null;
    }
    if (type === 'number') {
      const n = Number(raw);
      return isNaN(n) ? null : n;
    }
    return null;
  }
}

module.exports = { ObjectValidator };
