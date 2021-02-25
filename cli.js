#!/usr/bin/env node
const path = require('path');
const args = process.argv.slice(2);
const dir = path.isAbsolute(args[1]) ? args[1] : path.join(process.cwd(), args[1] || '');

if (args[0] === 'down') {
  require('./dist/scripts/make-private').default(dir, args[1]);
}

else if (args[0] === 'up') {
  if (args[1]) {
    require('./dist/scripts/deploy').deploy(dir, args[2], '', true);
  }
  require('./dist/scripts/make-public').default(dir, args[2]);
}

else if (args[0] === 'serve') {
  if (!dir) {
    return console.error('Directory required.');
  }
  require('./dist/scripts/serve').serve(dir);
}