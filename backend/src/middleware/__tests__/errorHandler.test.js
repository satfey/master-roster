const multer = require('multer');
const errorHandler = require('../errorHandler');

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('errorHandler', () => {
  test('a MulterError (e.g. wrong multipart field name) maps to 400, not 500', () => {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file');
    const res = makeRes();

    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: err.message }));
  });

  test('an error with its own .status is respected as before', () => {
    const err = Object.assign(new Error('Missing required field'), { status: 400 });
    const res = makeRes();

    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('an error with no .status still defaults to 500', () => {
    const err = new Error('Something broke');
    const res = makeRes();

    errorHandler(err, {}, res, () => {});

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
