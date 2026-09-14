const jwt = require('jsonwebtoken');

/**
 * The signing secret is the single thing standing between a stranger and a forged token for any
 * account, so it is checked once, at startup, instead of failing per-request later.
 *
 * A missing secret already failed closed (jwt.sign/verify throw), but a SHORT or guessable one
 * failed OPEN and silently: everything works, and anyone who guesses the string can mint a token
 * for any userId. 32 characters is the floor for HS256 here. The check runs in production only —
 * tests and local development set short literal secrets on purpose.
 */
const JWT_SECRET = process.env.JWT_SECRET;
const MIN_SECRET_LENGTH = 32;

if (process.env.NODE_ENV === 'production') {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be set — refusing to start');
  }
  if (JWT_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters — refusing to start with a guessable signing key`);
  }
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
