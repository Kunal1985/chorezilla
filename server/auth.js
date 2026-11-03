const { scryptSync, randomBytes, createHash, timingSafeEqual } = require('crypto');

function hashSecret(secret, N = 16384) {
  const salt = randomBytes(16).toString('hex');
  const r = 8;
  const p = 1;
  const hash = scryptSync(String(secret), salt, 32, { N, r, p }).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

function verifySecret(secret, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = Buffer.from(parts[5], 'hex');
  if (!N || !r || !p || expected.length !== 32) return false;
  const actual = scryptSync(String(secret), salt, 32, { N, r, p });
  return timingSafeEqual(actual, expected);
}

function newToken() {
  return randomBytes(32).toString('hex');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(/; */)) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return '';
}

function sessionCookie(token, { secure, maxAge }) {
  const bits = [
    `cz_session=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

function clearCookie({ secure }) {
  const bits = ['cz_session=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

module.exports = { hashSecret, verifySecret, newToken, hashToken, readCookie, sessionCookie, clearCookie };
