const xlsx = require('xlsx');
const path = require('path');

const filePath = '/Users/macair/Downloads/Vouch AI/FD_Transactions.xlsx';

const data = [
  {
    "Transaction ID": "TXN-FD-001",
    "Date": "17-Jul-2025",
    "Vendor": "HSBC Bank",
    "Amount": 90000000.00,
    "Reference Number": "002-026680-095",
    "Description": "Fixed Deposit Creation for SPRNG TRANSFORM SUN ENERGY PRIVATE LIMITED"
  },
  {
    "Transaction ID": "TXN-FD-002",
    "Date": "21-Jul-2025",
    "Vendor": "HSBC Bank",
    "Amount": 32500000.00,
    "Reference Number": "002-026698-093",
    "Description": "Fixed Deposit Creation for SPRNG SURYODAY ENERGY PRIVATE LIMITED"
  },
  {
    "Transaction ID": "TXN-FD-003",
    "Date": "27-Oct-2025",
    "Vendor": "HSBC Bank",
    "Amount": 32500000.00,
    "Reference Number": "002-030724-063",
    "Description": "Fixed Deposit Creation for SPRNG UJJVALA ENERGY PRIVATE LIMITED"
  },
  {
    "Transaction ID": "TXN-FD-004",
    "Date": "26-Aug-2025",
    "Vendor": "HSBC Bank",
    "Amount": 20000000.00,
    "Reference Number": "002-034171-940",
    "Description": "Fixed Deposit Creation for ARINSUN CLEAN ENERGY PRIVATE LIMITED"
  },
  {
    "Transaction ID": "TXN-FD-005",
    "Date": "13-Oct-2025",
    "Vendor": "HSBC Bank",
    "Amount": 32500000.00,
    "Reference Number": "002-034171-944",
    "Description": "Fixed Deposit Creation for ARINSUN CLEAN ENERGY PRIVATE LIMITED"
  },
  {
    "Transaction ID": "TXN-MAIL-001",
    "Date": "03-Apr-2025",
    "Vendor": "Gupta, Nikhil SPRNG",
    "Amount": 150000000.00,
    "Reference Number": "FD Liquidation & Creation",
    "Description": "Email Approval for FD Liquidation & Creation"
  },
  {
    "Transaction ID": "TXN-MAIL-002",
    "Date": "05-May-2025",
    "Vendor": "Patil, Maruti SPRNG",
    "Amount": 390000000.00,
    "Reference Number": "FD Liquidation & Creation",
    "Description": "Email Approval for FD Liquidation & Creation"
  },
  {
    "Transaction ID": "TXN-MAIL-003",
    "Date": "08-Apr-2025",
    "Vendor": "Patil, Maruti SPRNG",
    "Amount": 35000000.00,
    "Reference Number": "FD Liquidation & Creation",
    "Description": "Email Approval for FD Liquidation & Creation"
  },
  {
    "Transaction ID": "TXN-MAIL-004",
    "Date": "13-Oct-2025",
    "Vendor": "Patil, Maruti SPRNG",
    "Amount": 40000000.00,
    "Reference Number": "FD Liquidation & Creation",
    "Description": "Email Approval for FD Liquidation & Creation"
  },
  {
    "Transaction ID": "TXN-MAIL-005",
    "Date": "14-Nov-2025",
    "Vendor": "Patil, Maruti SPRNG",
    "Amount": 32500000.00,
    "Reference Number": "FD Liquidation & Creation",
    "Description": "Email Approval for FD Liquidation & Creation"
  },
  {
    "Transaction ID": "TXN-FD-MISMATCH",
    "Date": "17-Jul-2025",
    "Vendor": "HSBC Bank",
    "Amount": 95000000.00,
    "Reference Number": "002-026680-095",
    "Description": "Fixed Deposit Creation with incorrect amount"
  },
  {
    "Transaction ID": "TXN-FD-FLAGGED",
    "Date": "25-Dec-2025",
    "Vendor": "Barclays Bank",
    "Amount": 50000000.00,
    "Reference Number": "002-999999-999",
    "Description": "Fixed Deposit Creation with missing document"
  }
];

const wb = xlsx.utils.book_new();
const ws = xlsx.utils.json_to_sheet(data);
xlsx.utils.book_append_sheet(wb, ws, 'FD_Transactions');
xlsx.writeFile(wb, filePath);

console.log(`Successfully created FD_Transactions.xlsx at ${filePath}`);
