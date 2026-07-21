// Bikin atau update satu akun admin di tabel `users`. Dijalankan manual di
// komputer sendiri (bukan lewat API publik) supaya password tidak pernah
// lewat internet dalam bentuk apa pun selain saat login asli.
//
// Cara pakai (butuh DATABASE_URL sudah di-set di environment, sama seperti
// yang dipakai Vercel):
//   node scripts/seed-admin.js
// lalu ikuti pertanyaan di terminal.

const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool, ensureUsersTable } = require('../lib/db');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL belum di-set. Set dulu env variable ini (sama seperti di Vercel) sebelum menjalankan script ini.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const username = (await ask(rl, 'Username (huruf kecil, tanpa spasi): ')).trim();
  const displayName = (await ask(rl, 'Nama tampilan (mis. "Darto"): ')).trim();
  const avatarInitial = (await ask(rl, `Inisial avatar (1 huruf, default "${displayName[0] || '?'}"): `)).trim() || displayName[0] || '?';
  const password = await ask(rl, 'Password baru: ');

  rl.close();

  if (!username || !displayName || !password) {
    console.error('Username, nama tampilan, dan password wajib diisi.');
    process.exit(1);
  }

  await ensureUsersTable();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (username, password_hash, display_name, avatar_initial, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       display_name = EXCLUDED.display_name,
       avatar_initial = EXCLUDED.avatar_initial`,
    [username, passwordHash, displayName, avatarInitial.toUpperCase()]
  );

  console.log(`Akun "${username}" (${displayName}) sudah disimpan/diupdate.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
