// Inlines flpmerge.js into index.html -> skarv.html (one file to open locally)
const fs = require('fs'), path = require('path');
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const engine = fs.readFileSync(path.join(dir, 'flpmerge.js'), 'utf8');
const tag = '<script src="flpmerge.js"></script>';
if (!html.includes(tag)) throw new Error('script tag not found in index.html');
fs.writeFileSync(path.join(dir, 'skarv.html'), html.replace(tag, () => '<script>\n' + engine + '\n</script>'));
console.log('skarv.html written');
