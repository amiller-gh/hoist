#!/usr/bin/env node
const args = process.argv.slice(2);

require('./dist/scripts/make-public').default(process.cwd(), args[1]);