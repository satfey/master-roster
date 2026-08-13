const swaggerJSDoc = require('swagger-jsdoc');

// Reusable entity + envelope schemas, referenced from the @swagger JSDoc
// blocks in src/routes/*.js via $ref so every endpoint shares one
// definition per resource instead of redeclaring its shape.
const schemas = {
  ApiResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'OK' },
      data: {},
    },
  },
  ApiError: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string', example: 'Something went wrong' },
      errors: { type: 'object', nullable: true, example: null },
    },
  },
  Identity: {
    type: 'object',
    description: 'The requesting identity attached to req.user. Currently always a fixed system identity — see /login.',
    properties: {
      id: { type: 'string', format: 'uuid', nullable: true },
      name: { type: 'string', example: 'John Admin' },
      email: { type: 'string', format: 'email', example: 'admin@test.com' },
      role: { type: 'string', example: 'ADMIN' },
      permissions: { type: 'array', items: { type: 'string' }, example: ['*'] },
      storeId: { type: 'string', format: 'uuid', nullable: true },
      areaStoreIds: { type: 'array', items: { type: 'string', format: 'uuid' }, example: [] },
    },
  },
  Role: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Store Manager' },
      permissions: {
        type: 'array',
        items: { type: 'string' },
        example: ['MANAGE_STORE', 'ENTER_SALES', 'MANAGE_ROSTER'],
      },
    },
  },
  Store: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      name: { type: 'string', example: 'Bangna Store' },
      region: { type: 'string', nullable: true, example: 'Bangkok' },
      area_coach_id: { type: 'string', format: 'uuid', nullable: true, example: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002' },
      storeCode: { type: 'string', nullable: true, example: '1001', description: 'Join key for the sales report importer (col B "Store Id", matched via String(reportStoreId))' },
    },
  },
  Employee: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'cccccccc-cccc-cccc-cccc-cccccccc0001' },
      store_id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      full_name: { type: 'string', example: 'สมชาย ใจดี' },
      position: { type: 'string', nullable: true, example: 'Cashier' },
      hourly_rate: { type: 'number', format: 'float', nullable: true, example: 120 },
      is_active: { type: 'boolean', default: true },
    },
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003' },
      full_name: { type: 'string', example: 'Bob Manager' },
      email: { type: 'string', format: 'email', example: 'manager1@test.com' },
      role_id: { type: 'string', format: 'uuid', example: '33333333-3333-3333-3333-333333333333' },
      store_id: { type: 'string', format: 'uuid', nullable: true, example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      is_active: { type: 'boolean', example: true },
    },
  },
  SalesSourceType: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'POS' },
    },
  },
  SalesRecord: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001' },
      store_id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      sales_date: { type: 'string', format: 'date', example: '2026-07-25' },
      amount: { type: 'number', format: 'float', example: 25000 },
      source_type_id: { type: 'string', format: 'uuid', example: 'dddddddd-dddd-dddd-dddd-dddddddd0001' },
      entered_by: { type: 'string', format: 'uuid', nullable: true, example: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003' },
      created_at: { type: 'string', format: 'date-time', example: '2026-07-31T03:25:54.489843' },
    },
  },
  SalesReport: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      store_id: { type: 'string', format: 'uuid' },
      report_store_id: { type: 'integer', example: 1001 },
      store_bu_id: { type: 'integer', nullable: true, example: 5 },
      store_name: { type: 'string', nullable: true, example: 'Bangna Store' },
      week: { type: 'string', nullable: true, example: '2026-27' },
      report_date: { type: 'string', format: 'date', example: '2026-08-03' },
      gross_actual: { type: 'number', nullable: true },
      gross_budget: { type: 'number', nullable: true },
      gross_variance_percent: { type: 'number', nullable: true, example: 0.052 },
      gross_actual_ly: { type: 'number', nullable: true },
      gross_ly_variance_percent: { type: 'number', nullable: true },
      gross_actual_mtd: { type: 'number', nullable: true },
      gross_budget_mtd: { type: 'number', nullable: true },
      gross_mtd_variance_percent: { type: 'number', nullable: true },
      gross_actual_ly_mtd: { type: 'number', nullable: true },
      docket_actual: { type: 'integer', nullable: true },
      docket_budget: { type: 'integer', nullable: true },
      docket_variance_percent: { type: 'number', nullable: true },
      docket_actual_ly: { type: 'integer', nullable: true },
      docket_ly_variance_percent: { type: 'number', nullable: true },
      customer_actual: { type: 'integer', nullable: true },
      customer_budget: { type: 'integer', nullable: true },
      customer_variance_percent: { type: 'number', nullable: true },
      customer_actual_ly: { type: 'integer', nullable: true },
      customer_ly_variance_percent: { type: 'number', nullable: true },
      other_sales: { type: 'number', nullable: true },
      service_charge: { type: 'number', nullable: true },
      source_type_id: { type: 'string', format: 'uuid' },
      entered_by: { type: 'string', format: 'uuid', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
    },
  },
  ForecastModelRun: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '12121212-1212-1212-1212-121212121212' },
      run_at: { type: 'string', format: 'date-time' },
      model_version: { type: 'string', example: 'SMA-7' },
      accuracy_score: { type: 'number', format: 'float', nullable: true },
    },
  },
  SalesForecast: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '13131313-1313-1313-1313-131313131301' },
      store_id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      forecast_date: { type: 'string', format: 'date', example: '2026-08-01' },
      daypart: { type: 'string', example: 'FULL_DAY' },
      forecasted_sales: { type: 'number', format: 'float', example: 32000 },
      model_run_id: { type: 'string', format: 'uuid', example: '12121212-1212-1212-1212-121212121212' },
    },
  },
  LaborGuideline: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '14141414-1414-1414-1414-141414141401' },
      store_id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      target_productivity: { type: 'number', format: 'float', nullable: true, example: 1200 },
      target_col_percent: { type: 'number', format: 'float', nullable: true, example: 22 },
      min_staff_per_shift: { type: 'number', format: 'float', nullable: true, example: 3 },
    },
  },
  ActualHours: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '18181818-1818-1818-1818-181818181801' },
      shift_id: { type: 'string', format: 'uuid', example: '17171717-1717-1717-1717-171717171701' },
      actual_hours: { type: 'number', format: 'float', example: 8 },
      clock_in: { type: 'string', format: 'date-time', nullable: true, example: '2026-08-03T08:01:00' },
      clock_out: { type: 'string', format: 'date-time', nullable: true, example: '2026-08-03T16:05:00' },
      recorded_by: { type: 'string', format: 'uuid', nullable: true, example: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003' },
    },
  },
  Shift: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '17171717-1717-1717-1717-171717171701' },
      roster_id: { type: 'string', format: 'uuid', example: '16161616-1616-1616-1616-161616161601' },
      employee_id: { type: 'string', format: 'uuid', example: 'cccccccc-cccc-cccc-cccc-cccccccc0001' },
      shift_date: { type: 'string', format: 'date', example: '2026-08-03' },
      start_time: { type: 'string', example: '08:00:00' },
      end_time: { type: 'string', example: '16:00:00' },
      planned_hours: { type: 'number', format: 'float', example: 8 },
    },
  },
  Roster: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', example: '16161616-1616-1616-1616-161616161601' },
      store_id: { type: 'string', format: 'uuid', example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' },
      week_start: { type: 'string', format: 'date', example: '2026-08-03' },
      status: { type: 'string', example: 'APPROVED' },
      approved_by: { type: 'string', format: 'uuid', nullable: true, example: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002' },
      approved_at: { type: 'string', format: 'date-time', nullable: true },
    },
  },
};

const responses = {
  BadRequestError: {
    description: 'The request was invalid (missing/malformed fields).',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message: 'Missing required field(s)', errors: null },
      },
    },
  },
  UnauthorizedError: {
    description: 'No valid Bearer token was supplied.',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message: 'Not authenticated', errors: null },
      },
    },
  },
  ForbiddenError: {
    description: "The authenticated user's role/permissions don't allow this action.",
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message: 'You do not have permission to perform this action', errors: null },
      },
    },
  },
  NotFoundError: {
    description: 'No resource exists for the given id.',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message: 'Resource not found', errors: null },
      },
    },
  },
  ServerError: {
    description: 'Unexpected server/database error.',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
        example: { success: false, message: 'Internal server error', errors: null },
      },
    },
  },
};

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Master Roster API',
      version: '1.0.0',
      description:
        'AI Workforce Scheduling System — REST API documentation. ' +
        'All responses are wrapped as `{ success, message, data }` (see ApiResponse) on success, ' +
        'or `{ success, message, errors }` (see ApiError) on failure. ' +
        'NOTE: real login/JWT issuance is not implemented yet (see /login) — the API currently ' +
        'runs every request as a fixed system identity — but all protected routes below document ' +
        'the intended Bearer-auth contract (see securitySchemes.bearerAuth) for when it lands.',
    },
    servers: [{ url: '/api', description: 'API base path' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas,
      responses,
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/app.js'],
};

module.exports = swaggerJSDoc(options);
