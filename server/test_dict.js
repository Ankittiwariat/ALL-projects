import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

async function main() {
    const filePath = path.resolve('/var/www/html/ai-llm May21/server/datasets/raw-pdfs/Tuvaluan_Dictionary_Superscript_Fixed.pdf');
    if (!fs.existsSync(filePath)) {
        console.log("File not found!");
        process.exit(1);
    }
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text;
    
    console.log("Total length:", text.length);
    console.log("Sample text from middle:");
    const mid = Math.floor(text.length / 4);
    console.log(text.slice(mid, mid + 1000));
}
main();
