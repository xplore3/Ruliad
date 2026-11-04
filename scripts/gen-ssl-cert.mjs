const selfsigned = require('selfsigned');
console.log('Module exports:', typeof selfsigned, Object.keys(selfsigned));
const generate = selfsigned.default || selfsigned.generate || selfsigned;
console.log('Generate fn:', typeof generate);

const attrs = [{ name: 'commonName', value: 'localhost' }];
const opts = { days: 365, keySize: 2048 };
const pems = generate(attrs, opts);
console.log('Result type:', typeof pems, pems ? Object.keys(pems) : null);
if (pems && typeof pems === 'object') {
  for (const k of Object.keys(pems)) {
    console.log(`  ${k}:`, typeof pems[k], pems[k] ? String(pems[k]).substring(0,60) : 'empty');
  }
}
