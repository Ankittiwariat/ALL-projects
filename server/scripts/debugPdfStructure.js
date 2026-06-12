import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function debug(filename) {
    const buf = fs.readFileSync(path.join(__dirname, '../newDataset', filename));
    const data = await pdfParse(buf);
    
    const lines = data.text.split('\n');
    console.log(`\n=== ${filename} ===`);
    console.log(`Total lines: ${lines.length}\n`);
    
    // Show first 120 lines to understand structure
    lines.slice(0, 120).forEach((line, i) => {
        console.log(`[${String(i).padStart(3)}] ${JSON.stringify(line)}`);
    });
}

await debug('tuvaluan-dictionary-formatted.pdf');
