import { promisify } from "node:util";
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const scryptAsync = promisify(scrypt);

const KEYLEN = 32;
const SALT_LEN = 16;
const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAXMEM = 64 * 1024 * 1024;
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function fromB64url(value) {
  return Buffer.from(value, "base64url");
}

function scryptOptions({ N, r, p }) {
  return { N, r, p, maxmem: MAXMEM };
}

function formatScryptHash(salt, hash, { N, r, p }) {
  return `$scrypt$N=${N}$r=${r}$p=${p}$${b64url(salt)}$${b64url(hash)}`;
}

export function parseScryptHash(stored) {
  if (typeof stored !== "string" || !stored.startsWith("$scrypt$")) {
    return null;
  }
  const parts = stored.split("$");
  if (parts.length !== 7) {
    return null;
  }
  const nPart = /^N=(\d+)$/.exec(parts[2]);
  const rPart = /^r=(\d+)$/.exec(parts[3]);
  const pPart = /^p=(\d+)$/.exec(parts[4]);
  if (!nPart || !rPart || !pPart || !parts[5] || !parts[6]) {
    return null;
  }
  const N = Number(nPart[1]);
  const r = Number(rPart[1]);
  const p = Number(pPart[1]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > MAX_R || p < 1 || p > MAX_P) {
    return null;
  }
  let salt;
  let hash;
  try {
    salt = fromB64url(parts[5]);
    hash = fromB64url(parts[6]);
  } catch {
    return null;
  }
  if (salt.length < 8 || hash.length < 16) {
    return null;
  }
  return { N, r, p, salt, hash };
}

export function hashPasswordSync(password) {
  const salt = randomBytes(SALT_LEN);
  const params = { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P };
  const hash = scryptSync(password, salt, KEYLEN, scryptOptions(params));
  return formatScryptHash(salt, hash, params);
}

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LEN);
  const params = { N: DEFAULT_N, r: DEFAULT_R, p: DEFAULT_P };
  const hash = await scryptAsync(password, salt, KEYLEN, scryptOptions(params));
  return formatScryptHash(salt, hash, params);
}

function hashesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyPasswordSync(password, stored) {
  const parsed = parseScryptHash(stored);
  if (!parsed) {
    return false;
  }
  try {
    const actual = scryptSync(password, parsed.salt, parsed.hash.length, scryptOptions(parsed));
    return hashesEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

export async function verifyPassword(password, stored) {
  const parsed = parseScryptHash(stored);
  if (!parsed) {
    return false;
  }
  try {
    const actual = await scryptAsync(password, parsed.salt, parsed.hash.length, scryptOptions(parsed));
    return hashesEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}
