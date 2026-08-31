// Only proves route *registration* (no request is ever dispatched), so the
// only thing that needs stubbing is the module-load-time Supabase client
// construction (authenticate.js and several required services touch
// `config/supabase` at require time) — matching the same lightweight
// `jest.mock('../../config/supabase', () => ({}))` pattern already used by
// rosterGenerationService.test.js for the same reason.
jest.mock('../../config/supabase', () => ({}));

const router = require('../rosterRoutes');

function findRoute(routePath, method) {
  return router.stack.find((layer) => layer.route && layer.route.path === routePath && layer.route.methods[method]);
}

describe('rosterRoutes — legacy fixed-template generator removed, auto-generate is the only supported generator', () => {
  test('POST /generate (the legacy FIXED_SHIFTS generator) is no longer registered', () => {
    expect(findRoute('/generate', 'post')).toBeUndefined();
  });

  test('POST /auto-generate (the only supported roster-generation endpoint) is still registered', () => {
    expect(findRoute('/auto-generate', 'post')).toBeDefined();
  });

  test('unrelated roster routes — validate, actual-hours, capacity, list/get/update/delete — remain registered untouched', () => {
    expect(findRoute('/validate', 'post')).toBeDefined();
    expect(findRoute('/actual-hours', 'post')).toBeDefined();
    expect(findRoute('/actual-hours', 'get')).toBeDefined();
    expect(findRoute('/capacity', 'get')).toBeDefined();
    expect(findRoute('/', 'get')).toBeDefined();
    expect(findRoute('/:id', 'get')).toBeDefined();
    expect(findRoute('/:id', 'put')).toBeDefined();
    expect(findRoute('/:id', 'delete')).toBeDefined();
  });

  test('the router exposes no route handler named `generate` anywhere (the legacy controller export is gone, not just unbound)', () => {
    const rosterController = require('../../controllers/rosterController');
    expect(rosterController.generate).toBeUndefined();
    expect(typeof rosterController.autoGenerate).toBe('function');
  });
});
