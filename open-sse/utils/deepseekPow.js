'use strict';

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function rotl64(v, k) {
  const shift = BigInt(k);
  return ((v << shift) | (v >> (64n - shift))) & 0xffffffffffffffffn;
}

function keccakF23(s) {
  let a0 = s[0], a1 = s[1], a2 = s[2], a3 = s[3], a4 = s[4];
  let a5 = s[5], a6 = s[6], a7 = s[7], a8 = s[8], a9 = s[9];
  let a10 = s[10], a11 = s[11], a12 = s[12], a13 = s[13], a14 = s[14];
  let a15 = s[15], a16 = s[16], a17 = s[17], a18 = s[18], a19 = s[19];
  let a20 = s[20], a21 = s[21], a22 = s[22], a23 = s[23], a24 = s[24];

  for (let r = 1; r < 24; r++) {
    const c0 = a0 ^ a5 ^ a10 ^ a15 ^ a20;
    const c1 = a1 ^ a6 ^ a11 ^ a16 ^ a21;
    const c2 = a2 ^ a7 ^ a12 ^ a17 ^ a22;
    const c3 = a3 ^ a8 ^ a13 ^ a18 ^ a23;
    const c4 = a4 ^ a9 ^ a14 ^ a19 ^ a24;

    const d0 = c4 ^ rotl64(c1, 1);
    const d1 = c0 ^ rotl64(c2, 1);
    const d2 = c1 ^ rotl64(c3, 1);
    const d3 = c2 ^ rotl64(c4, 1);
    const d4 = c3 ^ rotl64(c0, 1);

    a0 ^= d0; a5 ^= d0; a10 ^= d0; a15 ^= d0; a20 ^= d0;
    a1 ^= d1; a6 ^= d1; a11 ^= d1; a16 ^= d1; a21 ^= d1;
    a2 ^= d2; a7 ^= d2; a12 ^= d2; a17 ^= d2; a22 ^= d2;
    a3 ^= d3; a8 ^= d3; a13 ^= d3; a18 ^= d3; a23 ^= d3;
    a4 ^= d4; a9 ^= d4; a14 ^= d4; a19 ^= d4; a24 ^= d4;

    const b0 = a0;
    const b10 = rotl64(a1, 1);
    const b20 = rotl64(a2, 62);
    const b5 = rotl64(a3, 28);
    const b15 = rotl64(a4, 27);
    const b16 = rotl64(a5, 36);
    const b1 = rotl64(a6, 44);
    const b11 = rotl64(a7, 6);
    const b21 = rotl64(a8, 55);
    const b6 = rotl64(a9, 20);
    const b7 = rotl64(a10, 3);
    const b17 = rotl64(a11, 10);
    const b2 = rotl64(a12, 43);
    const b12 = rotl64(a13, 25);
    const b22 = rotl64(a14, 39);
    const b23 = rotl64(a15, 41);
    const b8 = rotl64(a16, 45);
    const b18 = rotl64(a17, 15);
    const b3 = rotl64(a18, 21);
    const b13 = rotl64(a19, 8);
    const b14 = rotl64(a20, 18);
    const b24 = rotl64(a21, 2);
    const b9 = rotl64(a22, 61);
    const b19 = rotl64(a23, 56);
    const b4 = rotl64(a24, 14);

    a0 = b0 ^ (~b1 & b2);
    a1 = b1 ^ (~b2 & b3);
    a2 = b2 ^ (~b3 & b4);
    a3 = b3 ^ (~b4 & b0);
    a4 = b4 ^ (~b0 & b1);

    a5 = b5 ^ (~b6 & b7);
    a6 = b6 ^ (~b7 & b8);
    a7 = b7 ^ (~b8 & b9);
    a8 = b8 ^ (~b9 & b5);
    a9 = b9 ^ (~b5 & b6);

    a10 = b10 ^ (~b11 & b12);
    a11 = b11 ^ (~b12 & b13);
    a12 = b12 ^ (~b13 & b14);
    a13 = b13 ^ (~b14 & b10);
    a14 = b14 ^ (~b10 & b11);

    a15 = b15 ^ (~b16 & b17);
    a16 = b16 ^ (~b17 & b18);
    a17 = b17 ^ (~b18 & b19);
    a18 = b18 ^ (~b19 & b15);
    a19 = b19 ^ (~b15 & b16);

    a20 = b20 ^ (~b21 & b22);
    a21 = b21 ^ (~b22 & b23);
    a22 = b22 ^ (~b23 & b24);
    a23 = b23 ^ (~b24 & b20);
    a24 = b24 ^ (~b20 & b21);

    a0 ^= RC[r];
  }

  s[0] = a0; s[1] = a1; s[2] = a2; s[3] = a3; s[4] = a4;
  s[5] = a5; s[6] = a6; s[7] = a7; s[8] = a8; s[9] = a9;
  s[10] = a10; s[11] = a11; s[12] = a12; s[13] = a13; s[14] = a14;
  s[15] = a15; s[16] = a16; s[17] = a17; s[18] = a18; s[19] = a19;
  s[20] = a20; s[21] = a21; s[22] = a22; s[23] = a23; s[24] = a24;
}

/**
 * Solves the DeepSeekHashV1 Proof of Work challenge.
 * 
 * @param {string} challengeHex - The target challenge in hex format.
 * @param {string} salt - The salt string.
 * @param {number} expireAt - Expire timestamp in seconds.
 * @param {number} difficulty - Difficulty limit.
 * @param {AbortSignal} [signal] - Optional abort signal to cancel search.
 * @returns {Promise<bigint>} The solved nonce (answer).
 */
async function solvePow(challengeHex, salt, expireAt, difficulty, signal) {
  const challenge = Buffer.from(challengeHex, 'hex');
  if (challenge.length !== 32) {
    throw new Error('pow: challenge must be 32 bytes (64 hex chars)');
  }
  const t0 = challenge.readBigUInt64LE(0);
  const t1 = challenge.readBigUInt64LE(8);
  const t2 = challenge.readBigUInt64LE(16);
  const t3 = challenge.readBigUInt64LE(24);

  const prefix = Buffer.from(`${salt}_${expireAt}_`);
  const rate = 136;
  const baseState = new Array(25).fill(0n);
  let off = 0;
  while (off + rate <= prefix.length) {
    for (let i = 0; i < rate / 8; i++) {
      baseState[i] ^= prefix.readBigUInt64LE(off + i * 8);
    }
    keccakF23(baseState);
    off += rate;
  }
  const tailLen = prefix.length - off;
  const tail = Buffer.alloc(rate);
  prefix.copy(tail, 0, off);

  const numBuf = Buffer.alloc(20);
  const buf = Buffer.alloc(rate);
  const buf2 = Buffer.alloc(rate);

  const limit = BigInt(difficulty || 144000);
  for (let n = 0n; n < limit; n++) {
    // Check abort signal periodically
    if ((n & 0x3FFn) === 0n) {
      if (signal?.aborted) {
        throw new Error('pow: aborted');
      }
      // Allow event loop to breathe occasionally for high difficulties
      await new Promise(resolve => setImmediate(resolve));
    }

    let v = n;
    let pos = 20;
    if (v === 0n) {
      pos--;
      numBuf[pos] = 48; // '0'
    } else {
      while (v > 0n) {
        pos--;
        numBuf[pos] = Number(48n + (v % 10n));
        v /= 10n;
      }
    }
    const numLen = 20 - pos;
    const totalTail = tailLen + numLen;

    const s = [...baseState];
    if (totalTail < rate) {
      buf.fill(0);
      tail.copy(buf, 0, 0, tailLen);
      numBuf.copy(buf, tailLen, pos, 20);
      buf[totalTail] = 0x06;
      buf[rate - 1] |= 0x80;

      for (let i = 0; i < rate / 8; i++) {
        s[i] ^= buf.readBigUInt64LE(i * 8);
      }
      keccakF23(s);
    } else {
      buf.fill(0);
      tail.copy(buf, 0, 0, tailLen);
      numBuf.copy(buf, tailLen, pos, pos + (rate - tailLen));
      for (let i = 0; i < rate / 8; i++) {
        s[i] ^= buf.readBigUInt64LE(i * 8);
      }
      keccakF23(s);

      buf2.fill(0);
      const rem = totalTail - rate;
      numBuf.copy(buf2, 0, pos + (rate - tailLen), pos + (rate - tailLen) + rem);
      buf2[rem] = 0x06;
      buf2[rate - 1] |= 0x80;
      for (let i = 0; i < rate / 8; i++) {
        s[i] ^= buf2.readBigUInt64LE(i * 8);
      }
      keccakF23(s);
    }

    if (s[0] === t0 && s[1] === t1 && s[2] === t2 && s[3] === t3) {
      return n;
    }
  }
  throw new Error('pow: no solution within difficulty');
}

/**
 * Builds the x-ds-pow-response base64 JSON payload.
 * 
 * @param {object} challengeObj - The challenge info returned by DeepSeek.
 * @param {bigint} answer - The solved nonce answer.
 * @returns {string} The base64-encoded PoW response header value.
 */
function buildPowHeader(challengeObj, answer) {
  const payload = {
    algorithm: challengeObj.algorithm,
    challenge: challengeObj.challenge,
    salt: challengeObj.salt,
    answer: Number(answer),
    signature: challengeObj.signature,
    target_path: challengeObj.target_path,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

module.exports = {
  solvePow,
  buildPowHeader,
};
