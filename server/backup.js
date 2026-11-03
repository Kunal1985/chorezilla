// Copy the live database to a new file. The app can keep running.
//   DATA_DIR=/data npm run backup
//   DATA_DIR=/data npm run backup -- /data/backups/manual.sqlite
const path = require('path');
const { openDatabase, backupDatabase } = require('./db');

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = process.argv[2] || path.join(dataDir, 'backups', `chorezilla-${stamp}.sqlite`);
const { db, file } = openDatabase(dataDir);
try {
  backupDatabase(db, dest);
  console.log(file);
  console.log(dest);
} finally {
  db.close();
}
