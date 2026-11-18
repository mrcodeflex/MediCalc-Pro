// Copies the MediCalc launcher icons into the generated Android project.
// Run after `npx cap add android` (the npm script and the GitHub workflow both do this).
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'android-assets', 'res');
const dst = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

if (!fs.existsSync(dst)) {
    console.error('android/ project not found. Run "npx cap add android" first.');
    process.exit(1);
}

let count = 0;
(function copy(from, to) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const a = path.join(from, entry.name);
        const b = path.join(to, entry.name);
        if (entry.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
        else { fs.copyFileSync(a, b); count++; }
    }
})(src, dst);

console.log(`Applied ${count} launcher icon resources to ${path.relative(process.cwd(), dst)}`);
