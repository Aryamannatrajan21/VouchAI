const xlsx = require('xlsx');
const path = require('path');

try {
  const filePath = '/Users/macair/Downloads/Doc1.xlsx';
  const workbook = xlsx.readFile(filePath);
  console.log("Sheet names in Doc1.xlsx:", workbook.SheetNames);
  
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    const rows = xlsx.utils.sheet_to_json(sheet);
    console.log(`\nSheet: ${sName} has ${rows.length} rows.`);
    if (rows.length > 0) {
      console.log("Columns:", Object.keys(rows[0]));
      console.log("First 5 rows:", JSON.stringify(rows.slice(0, 5), null, 2));
    }
  }
} catch (err) {
  console.error("Error reading file:", err);
}
