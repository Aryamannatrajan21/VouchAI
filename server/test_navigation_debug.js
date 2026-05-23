require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

const pageTreeIndex = [
  {
    "indexId": 0,
    "fileName": "002-026680-095-18072025.pdf",
    "section": "Page 1",
    "documentType": "Fixed Deposit Advice",
    "vendorName": "The Hongkong and Shanghai Banking Corporation Limited",
    "totalAmount": 90000000,
    "invoiceNumber": "002-026680-001",
    "date": "17-Jul-2025",
    "summary": "Fixed Deposit Advice from HSBC to SPRNG TRANSFORM SUN ENERGY PRIVATE LIMITED for principal amount of INR 90,000,000.00 starting 17-Jul-2025 with maturity 24-Jul-2025."
  },
  {
    "indexId": 1,
    "fileName": "002-026698-093-22072025.pdf",
    "section": "Page 1",
    "documentType": "Fixed Deposit Advice",
    "vendorName": "The Hongkong and Shanghai Banking Corporation Limited",
    "totalAmount": 32500000,
    "invoiceNumber": "002-026698-001",
    "date": "21-Jul-2025",
    "summary": "Fixed Deposit Advice from HSBC to SPRNG SURYODAY ENERGY PRIVATE LIMITED for principal amount of INR 32,500,000.00 starting 21-Jul-2025 with maturity 28-Jul-2025."
  }
];

const txn = {
  "Transaction ID": "TXN-FD-002",
  "Date": "21-Jul-2025",
  "Vendor": "HSBC Bank",
  "Amount": 32500000,
  "Reference Number": "002-026698-093",
  "Description": "Fixed Deposit Creation for SPRNG SURYODAY ENERGY PRIVATE LIMITED"
};

async function test() {
  const prompt = `You are a professional financial auditor navigation engine. Given a specific transaction and a structured index of all supporting documents (PageTreeIndex), identify which pages or sheets are highly likely to contain the supporting evidence for this transaction.

TRANSACTION TO AUDIT:
${JSON.stringify(txn, null, 2)}

SUPPORTING DOCUMENTS INDEX (PageTreeIndex):
${JSON.stringify(pageTreeIndex, null, 2)}

INSTRUCTIONS:
1. Search the PageTreeIndex for nodes where the vendor or account name matches (fuzzy).
2. Look for amounts that match or are close.
3. Look for matching dates or references.
4. Output a list of "indexId" numbers of the candidate pages/sheets. If no pages are relevant, return an empty array.
5. Return ONLY a raw JSON array of integers representing the indexIds. Do not add any explanation or markdown tags.
Example output: [0, 2]`;

  const response = await openai.chat.completions.create({
    model: "meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.05,
    max_tokens: 100,
  });
  
  console.log("Raw Response:", response.choices[0].message.content);
}

test();
