const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const downloadsDir = '/Users/macair/Downloads';
const targetTerms = [
  '002-026680-095', '002-026698-093', '002-030724-063', '002-034171-940', '002-034171-944',
  '90000000', '32500000', '20000000', 'HSBC', 'Hongkong', 'Suryoday', 'Arinsun'
];

const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xlsm') || f.endsWith('.csv'));

console.log(`Deep searching ${files.length} spreadsheets for FD-related terms...`);

for (const file of files) {
  const filePath = path.join(downloadsDir, file);
  try {
    const workbook = xlsx.readFile(filePath);
    for (const sName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sName];
      const rows = xlsx.utils.sheet_to_json(sheet);
      rows.forEach((row, idx) => {
        const rowStr = JSON.stringify(row).toLowerCase();
        for (const term of targetTerms) {
          if (rowStr.includes(term.toLowerCase())) {
            console.log(`[MATCH] File: "${file}", Sheet: "${sName}", Row ${idx+2}:`, row);
          }
        }
      });
    }
  } catch (err) {
    // Ignore read errors
  }
}
