const {
  loginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  __resetLoginAttempts,
  MAX_FAILURES,
  WINDOW_MS,
} = require('../loginRateLimit');

function makeReq({ ip = '203.0.113.5', email = 'victim@test.local' } = {}) {
  return { ip, body: { email } };
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
}

/** Drives `n` failed attempts through the middleware exactly as the login flow does. */
function fail(req, n) {
  for (let i = 0; i < n; i++) {
    loginRateLimit(req, makeRes(), jest.fn());
    recordFailedLogin(req);
  }
}

beforeEach(() => {
  __resetLoginAttempts();
  jest.useRealTimers();
});

describe('loginRateLimit', () => {
  test('a first attempt passes straight through', () => {
    const res = makeRes();
    const next = jest.fn();

    loginRateLimit(makeReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test(`attempts up to the limit (${MAX_FAILURES}) still pass`, () => {
    const req = makeReq();
    fail(req, MAX_FAILURES - 1);
    const res = makeRes();
    const next = jest.fn();

    loginRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('SECURITY: the attempt after the limit is refused with 429 and never reaches the controller', () => {
    const req = makeReq();
    fail(req, MAX_FAILURES);
    const res = makeRes();
    const next = jest.fn();

    loginRateLimit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  test('a successful login clears the counter, so a typo then a correct password is not punished', () => {
    const req = makeReq();
    fail(req, MAX_FAILURES - 1);
    clearLoginAttempts(req);
    fail(req, MAX_FAILURES - 1);

    const res = makeRes();
    const next = jest.fn();
    loginRateLimit(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('locking one account does not lock a different account from the same IP', () => {
    const attacked = makeReq({ email: 'victim@test.local' });
    fail(attacked, MAX_FAILURES);

    const colleague = makeReq({ email: 'someone.else@test.local' });
    const res = makeRes();
    const next = jest.fn();
    loginRateLimit(colleague, res, next);

    expect(next).toHaveBeenCalledTimes(1); // shared NAT must not take innocent users down
  });

  test('an attacker on another IP cannot lock a victim out of their own account', () => {
    const attacker = makeReq({ ip: '198.51.100.9', email: 'victim@test.local' });
    fail(attacker, MAX_FAILURES);

    const victim = makeReq({ ip: '203.0.113.5', email: 'victim@test.local' });
    const res = makeRes();
    const next = jest.fn();
    loginRateLimit(victim, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('the email match is case- and whitespace-insensitive, so casing does not reset the counter', () => {
    fail(makeReq({ email: 'victim@test.local' }), MAX_FAILURES);

    const res = makeRes();
    const next = jest.fn();
    loginRateLimit(makeReq({ email: '  VICTIM@TEST.LOCAL ' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  test('the block lifts once the window has passed', () => {
    const req = makeReq();
    fail(req, MAX_FAILURES);

    const realNow = Date.now;
    Date.now = () => realNow() + WINDOW_MS + 1000;
    try {
      const res = makeRes();
      const next = jest.fn();
      loginRateLimit(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });

  test('a missing email in the body does not crash the middleware', () => {
    const res = makeRes();
    const next = jest.fn();

    loginRateLimit({ ip: '203.0.113.5', body: {} }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
