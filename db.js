const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_STATE = { done: [], skip: [], timers: {}, vd: null, lastSeen: {} };

function filePath(userId) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

function getState(userId) {
  try {
    const raw = fs.readFileSync(filePath(userId), 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(userId, state) {
  fs.writeFileSync(filePath(userId), JSON.stringify(state), 'utf8');
}

module.exports = { getState, saveState };
