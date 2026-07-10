import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const source=path.resolve(process.env.BREW_DB_PATH??'./data/brew.db');
if(!fs.existsSync(source))throw new Error(`Database not found: ${source}`);
const directory=path.resolve(process.env.BREW_BACKUP_DIR??'./backups');fs.mkdirSync(directory,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');const target=path.join(directory,`brew-${stamp}.db`);
const database=new Database(source,{readonly:true});await database.backup(target);database.close();console.log(target);
