const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

async function test() {
  try {
    const fdrDir = '/Users/macair/Downloads/Vouch AI/FDR';
    const files = fs.readdirSync(fdrDir).filter(f => f.endsWith('.pdf'));
    
    for (const file of files) {
      const buffer = fs.readFileSync(path.join(fdrDir, file));
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      console.log(`\n================= FILE: ${file} =================`);
      console.log(result.text.trim());
      await parser.destroy();
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
