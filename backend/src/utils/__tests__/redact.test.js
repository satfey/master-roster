const { redact, describeError, REDACTED } = require('../redact');

describe('redact — sensitive values never reach a log', () => {
  test.each([
    'password',
    'Password',
    'password_hash',
    'newPassword',
    'JWT_SECRET',
    'secret',
    'accessToken',
    'apiKey',
    'api_key',
    'authorization',
    'cookie',
    'sessionId',
    'credential',
    'privateKey',
    'salt',
  ])('a key named %s is replaced', (key) => {
    expect(redact({ [key]: 'the-actual-value' })[key]).toBe(REDACTED);
  });

  test.each(['sl_comp_amount', 'hr_comp_amount', 'pay_rate_type', 'salary', 'wage'])(
    'pay field %s is replaced — salaries must not sit in logs either',
    (key) => {
      expect(redact({ [key]: 42000 })[key]).toBe(REDACTED);
    }
  );

  test('ordinary fields pass through untouched', () => {
    expect(redact({ storeId: '1001', firstName: 'Somchai', isActive: true, hours: 8 })).toEqual({
      storeId: '1001',
      firstName: 'Somchai',
      isActive: true,
      hours: 8,
    });
  });

  test('nested objects are redacted too, not just the top level', () => {
    const out = redact({ user: { email: 'a@b.c', password: 'hunter2' }, meta: { token: 'abc' } });
    expect(out.user.password).toBe(REDACTED);
    expect(out.meta.token).toBe(REDACTED);
    expect(out.user.email).toBe('a@b.c');
  });

  test('objects inside arrays are redacted', () => {
    const out = redact([{ password: 'x' }, { name: 'ok' }]);
    expect(out[0].password).toBe(REDACTED);
    expect(out[1].name).toBe('ok');
  });

  test('the input is not mutated — the caller keeps its real values', () => {
    const original = { password: 'hunter2' };
    redact(original);
    expect(original.password).toBe('hunter2');
  });

  test('null and undefined survive as themselves', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  test('a circular reference does not blow the stack', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(redact(a).self).toBe('[circular]');
  });

  test('a very long string is truncated rather than filling the log', () => {
    const out = redact({ note: 'x'.repeat(5000) });
    expect(out.note.length).toBeLessThan(5000);
    expect(out.note).toContain('[truncated]');
  });

  test('a huge array is capped and says how many were dropped', () => {
    const out = redact(Array.from({ length: 200 }, (_, i) => i));
    expect(out.length).toBeLessThan(200);
    expect(out[out.length - 1]).toContain('more');
  });

  test('deep nesting stops rather than recursing forever', () => {
    let deep = { value: 'bottom' };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
    expect(JSON.stringify(redact(deep))).toContain('depth limit');
  });
});

describe('describeError — what a 5xx writes to the server log', () => {
  test('keeps the message and stack, which is what a developer needs', () => {
    const out = describeError(new Error('boom'));
    expect(out.message).toBe('boom');
    expect(out.stack).toContain('boom');
    expect(out.name).toBe('Error');
  });

  test("SECURITY: a PostgREST error's details/hint are redacted, not copied verbatim", () => {
    const err = Object.assign(new Error('insert failed'), {
      code: '23505',
      details: { row: { first_name: 'Somchai', sl_comp_amount: 42000, password_hash: '$2b$10$abc' } },
      hint: 'check the unique constraint',
    });

    const out = describeError(err);

    expect(out.details.row.sl_comp_amount).toBe(REDACTED);
    expect(out.details.row.password_hash).toBe(REDACTED);
    expect(out.details.row.first_name).toBe('Somchai'); // still useful for debugging
    expect(out.code).toBe('23505');
    expect(out.hint).toBe('check the unique constraint');
  });

  test('a non-Error thrown value is still described safely', () => {
    expect(describeError({ password: 'hunter2' })).toEqual({ thrown: { password: REDACTED } });
  });

  test('an error with no details/hint does not invent them', () => {
    const out = describeError(new Error('plain'));
    expect(out.details).toBeUndefined();
    expect(out.hint).toBeUndefined();
  });
});
