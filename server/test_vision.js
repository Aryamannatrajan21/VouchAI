require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { PDFParse } = require('pdf-parse');
const OpenAI = require('openai');
const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

async function testVisionOCR() {
  try {
    const pdfPath = '/Users/macair/Downloads/Doc 1 test  (1).pdf';
    console.log("Loading PDF:", pdfPath);
    const buffer = fs.readFileSync(pdfPath);
    
    const parser = new PDFParse({ data: buffer });
    
    console.log("Rendering page 1 as PNG screenshot...");
    const screenshotResult = await parser.getScreenshot({ scale: 0.5 });
    await parser.destroy();
    
    if (!screenshotResult.pages || screenshotResult.pages.length === 0) {
      throw new Error("Failed to render page screenshot.");
    }
    
    const pageImageBuffer = screenshotResult.pages[0].data; // Buffer
    console.log(`Successfully rendered PNG screenshot. Buffer size: ${pageImageBuffer.length} bytes.`);
    
    // Save locally for quick inspection
    fs.writeFileSync('page_1_render.png', pageImageBuffer);
    console.log("Saved screenshot to page_1_render.png");
    
    const base64Image = pageImageBuffer.toString('base64').replace(/[\r\n\s]/g, '');
    
    console.log("Sending base64 image to meta/llama-3.2-11b-vision-instruct for transcription...");
    const response = await openai.chat.completions.create({
      model: "meta/llama-3.2-11b-vision-instruct",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "You are a professional financial document parser. Please transcribe all visible text, numbers, dates, reference numbers, line items, and vendor names from this document in a highly structured, readable text format."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 1500,
      temperature: 0.05
    });
    
    console.log("\n--- TRANSCRIBED TEXT ---");
    console.log(response.choices[0].message.content);
    console.log("------------------------");
    
  } catch (err) {
    console.error("Vision OCR Test Failed:", err);
  }
}

testVisionOCR();
