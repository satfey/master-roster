
require('dotenv').config();
const { hashPassword } = require('../src/utils/password');

async function main() {
  const plain = process.argv[2];
  if (!plain) {
    console.error('Usage: node scripts/hash-password.js "<password>"');
    process.exit(1);
  }

  const hash = await hashPassword(plain);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
