import { openDatabase } from '../db/database.js';
import { feeds } from '../db/schema.js';
const database=openDatabase();const feed=database.db.insert(feeds).values({url:'https://seed.brew.local/feed',title:'Performance seed'}).onConflictDoUpdate({target:feeds.url,set:{title:'Performance seed'}}).returning().get();
database.sqlite.transaction(()=>{const insert=database.sqlite.prepare('INSERT OR IGNORE INTO articles(feed_id,guid,url,title,published_at,hash) VALUES(?,?,?,?,?,?)');for(let index=0;index<10_000;index++)insert.run(feed.id,`seed-${index}`,`https://seed.brew.local/${index}`,`Seed article ${index}`,Date.now()-index*60_000,`seed-${index}`)})();
const result=database.sqlite.prepare("SELECT count(*) AS count FROM articles WHERE guid LIKE 'seed-%'").get() as {count:number};console.log(`Seeded ${result.count} articles`);database.close();
