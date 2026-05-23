const xlsx = require('xlsx');

try {
  const filePath = '/Users/macair/Downloads/FDR_Audit_Results.xlsx';
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  console.log("=== RECONCILED AUDIT RESULTS FROM FDR_Audit_Results.xlsx ===");
  console.log(JSON.stringify(rows, null, 2));
} catch (err) {
  console.error("Error reading final Excel sheet:", err);
}
