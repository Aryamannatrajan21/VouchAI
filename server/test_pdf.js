const pdf = require('pdf-parse');
const fs = require('fs');

async function testPdfParse(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    
    // Custom page rendering function to inject page boundaries
    let pageCount = 0;
    const options = {
      pagerender: function (pageData) {
        return pageData.getTextContent().then(function (textContent) {
          pageCount++;
          let lastY, text = '';
          for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str + ' ';
            } else {
              text += '\n' + item.str + ' ';
            }
            lastY = item.transform[5];
          }
          return `\n--- PAGE_START_${pageCount} ---\n` + text + `\n--- PAGE_END_${pageCount} ---\n`;
        });
      }
    };

    console.log("Parsing PDF page by page...");
    const data = await pdf(dataBuffer, options);
    
    console.log("Total pages detected in metadata:", data.numpages);
    console.log("Rendered page count:", pageCount);
    
    // Split by page boundary
    const pages = [];
    for (let i = 1; i <= pageCount; i++) {
      const startTag = `--- PAGE_START_${i} ---`;
      const endTag = `--- PAGE_END_${i} ---`;
      const startIdx = data.text.indexOf(startTag);
      const endIdx = data.text.indexOf(endTag);
      
      if (startIdx !== -1 && endIdx !== -1) {
        const pageText = data.text.substring(startIdx + startTag.length, endIdx).trim();
        pages.push({
          pageNumber: i,
          text: pageText
        });
      }
    }
    
    console.log(`Successfully extracted ${pages.length} pages:`);
    pages.forEach(p => {
      console.log(`Page ${p.pageNumber}: ${p.text.substring(0, 150)}...`);
    });
    
  } catch (error) {
    console.error("PDF Parsing failed:", error);
  }
}

// If running directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    testPdfParse(args[0]);
  } else {
    console.log("Please provide a path to a PDF file. Usage: node test_pdf.js <path_to_pdf>");
  }
}

module.exports = { testPdfParse };
