const fs=require('node:fs');const path=require('node:path');
const root=__dirname;
const source=fs.readFileSync(path.join(root,'src/plugin.js'),'utf8');
const core=fs.readFileSync(path.join(root,'core.js'),'utf8');
fs.writeFileSync(path.join(root,'main.js'),source.replace("require('./core')",`(()=>{const module={exports:{}};\n${core}\nreturn module.exports;})()`));
console.log('Built main.js');
