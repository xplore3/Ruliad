const selfsigned = require('selfsigned');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const sslDir = path.join(os.homedir(), '.vite-ssl');
if (!fs.existsSync(sslDir)) {
  fs.mkdirSync(sslDir, { recursive: true });
}

const attrs = [{ name: 'commonName', value: 'localhost' }];
const opts = {
  days: 365 * 5,
  keySize: 2048,
  extensions: [
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, value: '127.0.0.1' },
        { type: 7, value: '172.16.120.11' },
      ],
    },
  ],
};

(async () => {
  const pems = await selfsigned.generate(attrs, opts);
  fs.writeFileSync(path.join(sslDir, 'cert.pem'), pems.cert);
  fs.writeFileSync(path.join(sslDir, 'key.pem'), pems.private);
  console.log('SSL certificates generated:');
  console.log('  ' + path.join(sslDir, 'cert.pem'));
  console.log('  ' + path.join(sslDir, 'key.pem'));
})();
