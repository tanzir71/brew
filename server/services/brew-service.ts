import { desc, eq } from 'drizzle-orm';
import type { BrewConfig, BrewConfigDraft, BrewItem, BrewSection, BrewSnapshot } from '../../shared/brew.js';
import type { BrewDatabase } from '../db/database.js';
import { brewConfigs, brews } from '../db/schema.js';

type ItemRow = Omit<BrewItem, 'publishedAt' | 'readAt' | 'readTimeMinutes'> & { publishedAt:number; readAt:number|null; body:string|null };
export class BrewService {
  constructor(private readonly database:BrewDatabase) {}
  listConfigs(): BrewConfig[] { return this.database.db.select().from(brewConfigs).all().map((row) => ({ id:row.id, name:row.name, scheduleCron:row.scheduleCron, enabled:row.enabled, sections:JSON.parse(row.sectionsJson), createdAt:row.createdAt.toISOString() })); }
  create(draft:BrewConfigDraft):BrewConfig { this.validate(draft); const row=this.database.db.insert(brewConfigs).values({name:draft.name.trim(),scheduleCron:draft.scheduleCron,enabled:draft.enabled,sectionsJson:JSON.stringify(draft.sections)}).returning().get(); return this.listConfigs().find((item)=>item.id===row.id)!; }
  update(id:number,draft:BrewConfigDraft):BrewConfig|null { this.validate(draft); const row=this.database.db.update(brewConfigs).set({name:draft.name.trim(),scheduleCron:draft.scheduleCron,enabled:draft.enabled,sectionsJson:JSON.stringify(draft.sections)}).where(eq(brewConfigs.id,id)).returning().get(); return row ? this.listConfigs().find((item)=>item.id===id)! : null; }
  delete(id:number):boolean { return this.database.db.delete(brewConfigs).where(eq(brewConfigs.id,id)).run().changes>0; }
  private validate(draft:BrewConfigDraft) { if(!draft.name.trim()) throw new Error('Brew name is required'); for(const section of draft.sections) { if(section.maxItems<1||section.maxItems>20) throw new Error('Section size must be 1–20'); if(['folder','feed','tag'].includes(section.source)&&!section.sourceId) throw new Error('Choose a section source'); } }
  private items(section:BrewSection):BrewItem[] {
    const clauses=['a.hidden = 0','a.excluded_from_brew = 0']; const params:Array<number|string>=[];
    if(section.onlyUnread) clauses.push('a.read_at IS NULL');
    if(section.source==='folder'){clauses.push('f.folder_id = ?');params.push(section.sourceId!)}
    if(section.source==='feed'){clauses.push('a.feed_id = ?');params.push(section.sourceId!)}
    if(section.source==='tag'){clauses.push('EXISTS (SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.id=?)');params.push(section.sourceId!)}
    if(section.source==='starred'||section.source==='weekly_review') clauses.push('a.starred_at IS NOT NULL');
    if(section.source==='featured') clauses.push('a.featured_in_brew = 1');
    if(section.source==='today'){clauses.push('a.published_at >= ?');params.push(Date.now()-86_400_000)}
    if(section.source==='weekly_review'){clauses.push('a.published_at >= ?');params.push(Date.now()-7*86_400_000)}
    const order=section.sort==='longest' ? 'length(coalesce(a.full_text_html,a.content_html,a.summary_html,\'\')) DESC' : 'a.published_at DESC';
    params.push(section.maxItems);
    const rows=this.database.sqlite.prepare(`SELECT a.id,a.title,a.url,a.author,a.summary_html AS summaryHtml,a.image_url AS imageUrl,a.published_at AS publishedAt,a.read_at AS readAt,f.title AS feedTitle,coalesce(a.full_text_html,a.content_html,a.summary_html) AS body FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ?`).all(...params) as ItemRow[];
    return rows.map(({body,...row})=>({...row,publishedAt:new Date(row.publishedAt).toISOString(),readAt:row.readAt===null?null:new Date(row.readAt).toISOString(),readTimeMinutes:Math.max(1,Math.ceil((body?.replace(/<[^>]+>/g,'').split(/\s+/).length??0)/220))}));
  }
  generate(configId:number):BrewSnapshot { const config=this.listConfigs().find((item)=>item.id===configId); if(!config) throw new Error('Brew not found'); const payload={configName:config.name,sections:config.sections.map((section)=>({...section,items:this.items(section)}))}; const row=this.database.db.insert(brews).values({brewConfigId:configId,payloadJson:JSON.stringify(payload)}).returning().get(); const old=this.database.db.select({id:brews.id}).from(brews).where(eq(brews.brewConfigId,configId)).orderBy(desc(brews.generatedAt),desc(brews.id)).all().slice(30); for(const item of old)this.database.db.delete(brews).where(eq(brews.id,item.id)).run(); return this.snapshot(row.id)!; }
  history(configId:number):BrewSnapshot[]{ return this.database.db.select({id:brews.id}).from(brews).where(eq(brews.brewConfigId,configId)).orderBy(desc(brews.generatedAt),desc(brews.id)).all().map(({id})=>this.snapshot(id)!); }
  snapshot(id:number):BrewSnapshot|null { const row=this.database.db.select().from(brews).where(eq(brews.id,id)).get(); if(!row)return null; const payload=JSON.parse(row.payloadJson) as Pick<BrewSnapshot,'configName'|'sections'>; const scroll=(this.database.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(`brew_scroll_${id}`) as {value:string}|undefined)?.value; return {id:row.id,brewConfigId:row.brewConfigId,generatedAt:row.generatedAt.toISOString(),scrollPosition:Number(scroll??0),...payload}; }
  saveScroll(id:number,position:number){this.database.sqlite.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`brew_scroll_${id}`,String(Math.max(0,position)));}
  runScheduled(now=new Date()):number { let generated=0; const date=now.toISOString().slice(0,10); for(const config of this.listConfigs().filter((item)=>item.enabled)){const [minute,hour]=config.scheduleCron.trim().split(/\s+/);if(minute!==String(now.getMinutes())||hour!==String(now.getHours()))continue;const key=`brew_generated_${config.id}_${date}`;if(this.database.sqlite.prepare('SELECT 1 FROM settings WHERE key=?').get(key))continue;this.generate(config.id);this.database.sqlite.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(key,now.toISOString());generated++}return generated;}
}
