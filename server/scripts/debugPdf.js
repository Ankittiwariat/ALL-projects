import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

async function main() {
    const file = 'tuvalu_phrases_love and health.docx.pdf';
    const filepath = path.join(process.cwd(), 'datasets/raw-pdfs', file);
    const buffer = fs.readFileSync(filepath);
    const data = await pdfParse(buffer);
    console.log("PDF TEXT:\n================================\n");
    console.log(data.text);
}
main();
