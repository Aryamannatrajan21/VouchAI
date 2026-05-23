const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function extractFDR() {
  const dir = '/Users/macair/Downloads/Vouch AI/FDR';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  console.log("=== FDR ADVICE DETAILS ===");
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(dir, file));
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text || '';
    
    // Extract account name, number, principal amount, start date, maturity date
    const nameMatch = text.match(/Account Name\s+([\s\S]+?)\nPAN/i);
    const accMatch = text.match(/Account Number\s+(\d{3}-\d{6}-\d{3})/i);
    const principalMatch = text.match(/INR\s+([\d,]+\.\d{2})/i);
    const dateMatch = text.match(/([\d,]+\.\d{2})\s+[\d\.]+\s+([\w\-]+)\s+([\w\-]+)/i);

    console.log(`File: ${file}`);
    console.log(`  Account Name: ${nameMatch ? nameMatch[1].replace(/\n/g, ' ').trim() : 'N/A'}`);
    console.log(`  Account Number: ${accMatch ? accMatch[1] : 'N/A'}`);
    console.log(`  Principal Amount: ${principalMatch ? principalMatch[1] : 'N/A'}`);
    console.log(`  Dates: ${dateMatch ? `Start: ${dateMatch[2]}, Maturity: ${dateMatch[3]}` : 'N/A'}`);
    console.log("-----------------------------------------");
    await parser.destroy();
  }
}

async function extractMails() {
  const dir = '/Users/macair/Downloads/Vouch AI/Mail Confirmtion';
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
  console.log("\n=== MAIL CONFIRMATION SNIPPETS ===");
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(dir, file));
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text || '';
    
    console.log(`File: ${file}`);
    console.log(`  Subject: ${file.replace('.msg.pdf', '')}`);
    // Find some mentions of amounts or accounts
    const amounts = text.match(/[\d,]{7,12}(\.\d{2})?/g);
    console.log(`  Possible Amounts found:`, [...new Set(amounts || [])].slice(0, 5));
    console.log("-----------------------------------------");
    await parser.destroy();
  }
}

async function run() {
  await extractFDR();
  await extractMails();
}

run();
