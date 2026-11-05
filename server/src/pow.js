import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A proof of work instead of a CAPTCHA: a desktop app cannot show one. The server hands
 * out a signed challenge; the client must find a number that makes the SHA-256 of
 * "challenge:number" start with a given count of zero bits. It costs a fraction of a
 * second once, and makes sending thousands of requests expensive for a spammer.
 * Challenges are signed (nothing to store), expire, and work once.
 */

const TTL_MS = 5 * 60_000;

const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("hex").slice(0, 32);

export function makeChallenge(secret, now, bits) {
  const body = `v1.${now + TTL_MS}.${bits}.${randomBytes(12).toString("hex")}`;
  return `${body}.${sign(secret, body)}`;
}

/** The parts of a challenge the server signed, or why it is not valid. */
export function readChallenge(secret, challenge, now) {
  const parts = String(challenge).split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return { ok: false, reason: "défi illisible" };
  const [v, exp, bits, id, sig] = parts;
  const expected = sign(secret, `${v}.${exp}.${bits}.${id}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "défi falsifié" };
  if (Number(exp) < now) return { ok: false, reason: "défi expiré" };
  return { ok: true, id, exp: Number(exp), bits: Number(bits) };
}

export function leadingZeroBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}

export function checkSolution(secret, challenge, nonce, now, minBits) {
  const c = readChallenge(secret, challenge, now);
  if (!c.ok) return c;
  if (c.bits < minBits) return { ok: false, reason: "défi trop facile" };
  if (!/^[0-9a-z]{1,16}$/.test(nonce)) return { ok: false, reason: "solution invalide" };
  const h = createHash("sha256").update(`${challenge}:${nonce}`).digest();
  if (leadingZeroBits(h) < c.bits) return { ok: false, reason: "preuve de travail insuffisante" };
  return { ok: true, id: c.id, exp: c.exp };
}

/** What the app does: looks for the number. Used by the tests as well. */
export function solve(challenge) {
  const bits = Number(String(challenge).split(".")[2]);
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    if (leadingZeroBits(createHash("sha256").update(`${challenge}:${nonce}`).digest()) >= bits) return nonce;
  }
}
