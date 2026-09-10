const importJobStore = require('../importJobStore');

function uniqueId(label) {
  return `${label}-${Math.random().toString(36).slice(2)}`;
}

describe('importJobStore', () => {
  test('createJob starts at stage "parsing" (already in_progress), status "importing", with the other 3 stages pending', () => {
    const id = uniqueId('create');
    const job = importJobStore.createJob(id);

    expect(job.status).toBe('importing');
    expect(job.stage).toBe('parsing');
    expect(job.totalRows).toBeNull();
    expect(job.result).toBeNull();
    expect(job.error).toBeNull();
    expect(job.completedAt).toBeNull();
    expect(job.stages.map((s) => s.name)).toEqual(['parsing', 'transforming', 'validating', 'database_insert']);
    expect(job.stages[0]).toMatchObject({ name: 'parsing', status: 'in_progress' });
    expect(job.stages.slice(1).every((s) => s.status === 'pending')).toBe(true);
    expect(importJobStore.getJob(id)).toEqual(job);
  });

  test('getJob returns null for an id that was never created', () => {
    expect(importJobStore.getJob(uniqueId('missing'))).toBeNull();
  });

  test('beginStage marks the outgoing stage completed (with a real, non-negative duration) and the incoming stage in_progress', () => {
    const id = uniqueId('stages');
    importJobStore.createJob(id);

    importJobStore.beginStage(id, 'transforming', 'Transforming...');
    let job = importJobStore.getJob(id);
    expect(job.stage).toBe('transforming');
    const parsing = job.stages.find((s) => s.name === 'parsing');
    const transforming = job.stages.find((s) => s.name === 'transforming');
    expect(parsing.status).toBe('completed');
    expect(parsing.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(transforming.status).toBe('in_progress');
    expect(transforming.durationSeconds).toBeNull();
    expect(job.statusMessage).toBe('Transforming...');

    importJobStore.beginStage(id, 'validating', 'Validating...');
    importJobStore.beginStage(id, 'database_insert', 'Writing to database...');
    job = importJobStore.getJob(id);
    expect(job.stages.filter((s) => s.status === 'completed')).toHaveLength(3);
    expect(job.stages.find((s) => s.name === 'database_insert').status).toBe('in_progress');
  });

  test('setTotalRows records the row count once known, without touching stage/status', () => {
    const id = uniqueId('rows');
    importJobStore.createJob(id);

    importJobStore.setTotalRows(id, 117959);

    const job = importJobStore.getJob(id);
    expect(job.totalRows).toBe(117959);
    expect(job.stage).toBe('parsing');
    expect(job.status).toBe('importing');
  });

  test('complete() closes out the current stage, sets status/stage to completed, and attaches the real result', () => {
    const id = uniqueId('complete');
    importJobStore.createJob(id);
    importJobStore.beginStage(id, 'transforming', 'x');
    importJobStore.beginStage(id, 'validating', 'x');
    importJobStore.beginStage(id, 'database_insert', 'x');

    const result = { total: 2, imported: 2, inserted: 2, updated: 0 };
    importJobStore.complete(id, result);

    const job = importJobStore.getJob(id);
    expect(job.status).toBe('completed');
    expect(job.stage).toBe('completed');
    expect(job.result).toEqual(result);
    expect(job.completedAt).not.toBeNull();
    expect(job.stages.find((s) => s.name === 'database_insert').status).toBe('completed');
    expect(job.stages.every((s) => s.status === 'completed')).toBe(true); // every stage was visited before completion
  });

  test('fail() closes out the current stage as failed, sets status/stage to failed, and records the error message', () => {
    const id = uniqueId('fail');
    importJobStore.createJob(id);
    importJobStore.beginStage(id, 'database_insert', 'x');

    importJobStore.fail(id, new Error('simulated DB failure'));

    const job = importJobStore.getJob(id);
    expect(job.status).toBe('failed');
    expect(job.stage).toBe('failed');
    expect(job.error).toBe('simulated DB failure');
    expect(job.completedAt).not.toBeNull();
    expect(job.stages.find((s) => s.name === 'database_insert').status).toBe('failed');
  });

  test('fail() accepts a plain non-Error value too, without crashing', () => {
    const id = uniqueId('fail-plain');
    importJobStore.createJob(id);

    importJobStore.fail(id, 'a plain string error');

    expect(importJobStore.getJob(id).error).toBe('a plain string error');
  });

  test('operations on an unknown job id are no-ops, never throw', () => {
    const missing = uniqueId('missing-ops');
    expect(() => importJobStore.beginStage(missing, 'transforming', 'x')).not.toThrow();
    expect(() => importJobStore.setTotalRows(missing, 10)).not.toThrow();
    expect(() => importJobStore.complete(missing, {})).not.toThrow();
    expect(() => importJobStore.fail(missing, new Error('x'))).not.toThrow();
    expect(importJobStore.getJob(missing)).toBeNull();
  });
});
