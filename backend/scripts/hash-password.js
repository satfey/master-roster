// Prints a bcrypt hash for a plaintext password, for pasting into a manual
// `INSERT INTO users (..., password_hash) VALUES (..., '<hash>')` — so a
// plaintext password is never typed into a SQL query or stored anywhere.
//
// Usage: node scripts/hash-password.js "the-password"
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
