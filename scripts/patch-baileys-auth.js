import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const baileys = path.resolve(root, '../node_modules/@whiskeysockets/baileys/lib');
const validateFile = path.join(baileys, 'Utils/validate-connection.js');
const socketFile = path.join(baileys, 'Socket/socket.js');

function replaceOnce(file, from, to, label) {
  if (!fs.existsSync(file)) throw new Error(`Baileys file missing: ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(from)) {
    if (!to || source.includes(to)) return false;
    throw new Error(`Baileys patch target not found: ${label}`);
  }
  fs.writeFileSync(file, source.replace(from, to));
  return true;
}

replaceOnce(validateFile, '        passive: true,\n', '        passive: false,\n', 'passive login flag');
replaceOnce(validateFile, '        // TODO: investigate (hard set as false atm)\n        lidDbMigrated: false\n', '', 'lidDbMigrated login field');
replaceOnce(socketFile, '        await noise.finishInit();\n', '        noise.finishInit();\n', 'noise handshake timing');
console.log('Baileys auth compatibility patch applied.');
