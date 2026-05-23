const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function inspectDir(dirPath) {
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.pdf'));
    console.log(`\n--- Inspecting Directory: ${dirPath} ---`);
    for (const file of files.slice(0, 2)) { // Just first two files to avoid output overload
      const buffer = fs.readFileSync(path.join(dirPath, file));
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      console.log(`\n================= FILE: ${file} =================`);
      console.log("Number of Pages:", result.pages ? result.pages.length : 1);
      console.log("Text snippet (first 1000 chars):");
      console.log((result.text || '').substring(0, 1000));
      await parser.destroy();
    }
  } catch (err) {
    console.error(`Error reading ${dirPath}:`, err);
  }
}

async function run() {
  await inspectDir('/Users/macair/Downloads/Vouch AI/FDR');
  await inspectDir('/Users/macair/Downloads/Vouch AI/Mail Confirmtion');
}

run();
