const xlsx = require('xlsx');
const path = require('path');

try {
  const filePath = '/Users/macair/Downloads/Working file.xlsm';
  const workbook = xlsx.readFile(filePath);
  console.log("Sheet names in Working file.xlsm:", workbook.SheetNames);
  
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    const rows = xlsx.utils.sheet_to_json(sheet);
    console.log(`\nSheet: ${sName} has ${rows.length} rows.`);
    if (rows.length > 0) {
      console.log("Columns:", Object.keys(rows[0]));
      console.log("First 3 rows:", JSON.stringify(rows.slice(0, 3), null, 2));
    }
  }
} catch (err) {
  console.error("Error reading file:", err);
}
