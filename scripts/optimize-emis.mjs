import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', 'public', 'images', 'emis');

async function main() {
  const src = path.join(dir, 'full.png');
  const out = path.join(dir, 'full.webp');
  const info = await sharp(src)
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(out);
  console.log('full.webp written:', info);
}

main();
