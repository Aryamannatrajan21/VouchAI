const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    // Avoid node_modules or system folders
    if (file.startsWith('.') || file === 'node_modules' || file === 'Library') return;
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesRecursively(fullPath));
      } else {
        if (file.endsWith('.xlsx') || file.endsWith('.csv') || file.endsWith('.xlsm') || file.endsWith('.xls')) {
          results.push(fullPath);
        }
      }
    } catch (e) {}
  });
  return results;
}

try {
  console.log("Searching all spreadsheets in /Users/macair/Downloads recursively...");
  const spreadsheets = getFilesRecursively('/Users/macair/Downloads');
  console.log(`Found ${spreadsheets.length} spreadsheets. Checking contents...`);
  
  const targetTerms = ['002-026680-095', '90000000', '32500000', 'Arinsun', 'Suryoday'];
  
  for (const file of spreadsheets) {
    try {
      const workbook = xlsx.readFile(file);
      for (const sName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sName];
        const csv = xlsx.utils.sheet_to_csv(sheet).toLowerCase();
        for (const term of targetTerms) {
          if (csv.includes(term.toLowerCase())) {
            console.log(`[MATCH] Found term "${term}" in file: "${file}", Sheet: "${sName}"`);
          }
        }
      }
    } catch (e) {}
  }
  console.log("Finished search.");
} catch (err) {
  console.error("Recursive search failed:", err);
}
