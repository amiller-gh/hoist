#!/usr/bin/env node
const path = require('path');
const args = process.argv.slice(2);
const dir = path.isAbsolute(args[1]) ? args[1] : path.join(process.cwd(), args[1] || '');
const cliProgress = require('cli-progress');
const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

if (args[0] === 'down') {
  require('./dist/scripts/make-private').default(dir, args[1]);
}

else if (args[0] === 'up') {
  if (args[1]) {
    require('./dist/scripts/deploy').deploy(dir, args[2], '', {
      info: console.info.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      progress({ value, total }) {
        progress.setTotal(total);
        progress.update(value);
      }
    });
  }
  require('./dist/scripts/make-public').default(dir, args[2]);
}

else if (args[0] === 'serve') {
  if (!dir) {
    console.error('Directory required.');
  }
  else {
    require('./dist/scripts/serve').serve(dir);
  }
}