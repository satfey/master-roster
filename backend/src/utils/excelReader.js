const ExcelJS = require('exceljs');

async function readFirstSheetAsJson(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw Object.assign(new Error('The uploaded file has no worksheets'), {
      status: 400,
    });
  }

  const headers = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value).trim();
  });

  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const obj = { __row: rowNumber };

    row.eachCell((cell, colNumber) => {
      obj[headers[colNumber]] = cell.value;
    });

    if (Object.keys(obj).length > 1) {
      rows.push(obj);
    }
  });

  return rows;
}

module.exports = {
  readFirstSheetAsJson,
};