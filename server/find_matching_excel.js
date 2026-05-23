const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const downloadsDir = '/Users/macair/Downloads';
const targetTerms = ['SPRNG', 'Hongkong', 'HSBC', 'FIXED DEPOSIT', '90000000', '32500000'];

const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.csv') || f.endsWith('.xlsm'));

console.log(`Searching ${files.length} spreadsheet files in Downloads...`);

for (const file of files) {
  const filePath = path.join(downloadsDir, file);
  try {
    const workbook = xlsx.readFile(filePath);
    for (const sName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sName];
      const csv = xlsx.utils.sheet_to_csv(sheet);
      for (const term of targetTerms) {
        if (csv.toLowerCase().includes(term.toLowerCase())) {
          console.log(`[MATCH] Found term "${term}" in File: "${file}", Sheet: "${sName}"`);
        }
      }
    }
  } catch (err) {
    // Ignore read errors
  }
}
