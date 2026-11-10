// Coordinate dashboard and MCP requests that share one upstream school session.
const pending = new Map();

function runAccount(mandator, username, action) {
    const key = JSON.stringify([mandator, username]);
    if (pending.size >= 10000 && !pending.has(key)) return Promise.reject(new Error('School service busy'));
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    pending.set(key, current);
    current.finally(() => { if (pending.get(key) === current) pending.delete(key); }).catch(() => {});
    return current;
}

module.exports = { runAccount };
