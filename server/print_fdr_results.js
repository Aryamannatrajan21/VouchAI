const xlsx = require('xlsx');

try {
  const filePath = '/Users/macair/Downloads/FDR_Audit_Results.xlsx';
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  rows.forEach(row => {
    console.log(`\n=============================================`);
    console.log(`Txn ID:      ${row.txn_id}`);
    console.log(`Vendor:      ${row.vendor}`);
    console.log(`Dump Amt:    ${row.amount_dump}`);
    console.log(`Doc Amt:     ${row.amount_doc}`);
    console.log(`Status:      ${row.status.toUpperCase()}`);
    console.log(`Confidence:  ${row.confidence * 100}%`);
    console.log(`Notes:       ${row.auditor_notes}`);
  });
} catch (err) {
  console.error("Error:", err);
}
