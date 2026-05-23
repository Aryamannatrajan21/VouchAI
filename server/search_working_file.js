const xlsx = require('xlsx');

try {
  const filePath = '/Users/macair/Downloads/Working file.xlsm';
  const workbook = xlsx.readFile(filePath);
  
  for (const sName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sName];
    const rows = xlsx.utils.sheet_to_json(sheet);
    console.log(`Searching sheet "${sName}" (${rows.length} rows)...`);
    
    rows.forEach((row, i) => {
      const rowStr = JSON.stringify(row).toLowerCase();
      if (rowStr.includes('sprng') || rowStr.includes('hsbc') || rowStr.includes('hongkong') || rowStr.includes('deposit') || rowStr.includes('90000000') || rowStr.includes('32500000')) {
        console.log(`[MATCH] Sheet: "${sName}", Row ${i + 2}:`, row);
      }
    });
  }
} catch (err) {
  console.error("Error reading file:", err);
}
