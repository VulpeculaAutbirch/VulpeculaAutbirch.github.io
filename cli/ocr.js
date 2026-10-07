#!/usr/bin/env node
// Run an OCR pseudocode program from the command line:
//   node cli/ocr.js program.txt
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Interpreter, PseudoError } = require('../js/interpreter.js');

const file = process.argv[2];
if (!file || file === '-h' || file === '--help') {
  console.log('Usage: node cli/ocr.js <program-file>');
  process.exit(file ? 0 : 1);
}

let source;
try {
  source = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.error('Cannot read ' + file + ': ' + e.message);
  process.exit(1);
}

// stdin lines are handed out one at a time to input()
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const queued = [];
const waiting = [];
let closed = false;
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : queued.push(l)));
rl.on('close', () => {
  closed = true;
  while (waiting.length) waiting.shift()(null);
});

const io = {
  write: (text) => process.stdout.write(text),
  input: (prompt) => {
    process.stdout.write(prompt);
    if (queued.length) return Promise.resolve(queued.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => waiting.push(resolve));
  },
};

const baseDir = path.dirname(path.resolve(file));
const files = {
  read: (name) => {
    try { return fs.readFileSync(path.resolve(baseDir, name), 'utf8'); } catch (e) { return null; }
  },
  write: (name, text) => fs.writeFileSync(path.resolve(baseDir, name), text),
};

new Interpreter({ io, fs: files })
  .run(source)
  .then(() => {
    rl.close();
  })
  .catch((e) => {
    rl.close();
    if (e instanceof PseudoError) {
      const lines = source.replace(/\r\n?/g, '\n').split('\n');
      process.stderr.write('\n' + e.toString() + '\n');
      if (e.line && lines[e.line - 1] !== undefined) process.stderr.write('    ' + e.line + ' | ' + lines[e.line - 1].trim() + '\n');
    } else {
      process.stderr.write('\n' + (e && e.stack ? e.stack : String(e)) + '\n');
    }
    process.exitCode = 1;
  });
