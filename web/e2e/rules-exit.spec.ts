import {expect,test} from '@playwright/test';
import {openDatabase} from '../../server/db/database.js';
import {articles,feeds,folders} from '../../server/db/schema.js';
import {RulesService} from '../../server/services/rules-service.js';

test('creates five realistic rules in the UI and applies exact article states',async({page})=>{const database=openDatabase(':memory:');const folder=database.db.insert(folders).values({title:'Design',position:0}).returning().get();const feed=database.db.insert(feeds).values({title:'Design Notes',url:'https://rules-exit.test/feed',folderId:folder.id}).returning().get();const service=new RulesService(database);let duplicateFilter=false;
  await page.route('**/api/reader/navigation',route=>route.fulfill({json:{counts:{all:0,today:0,starred:0},folders:[{id:folder.id,title:'Design',unreadCount:0,feeds:[{id:feed.id,folderId:folder.id,title:'Design Notes',unreadCount:0,muted:false}]}],unfiled:[]}}));
  await page.route('**/api/rules/duplicate-filter',async route=>{if(route.request().method()==='PUT')duplicateFilter=Boolean((route.request().postDataJSON() as {enabled:boolean}).enabled);return route.fulfill({json:{enabled:duplicateFilter}})});
  await page.route('**/api/rules/preview',route=>route.fulfill({json:{items:[]}}));
  await page.route('**/api/rules',async route=>{if(route.request().method()==='GET')return route.fulfill({json:service.list()});return route.fulfill({status:201,json:service.create(route.request().postDataJSON())})});
  await page.goto('/');await page.getByRole('button',{name:'Rules'}).click();
  const save=async()=>{await page.getByRole('button',{name:'Save rule'}).click();await expect(page.getByRole('status')).toContainText('Rule saved.')};
  await page.getByRole('button',{name:'Mute keyword'}).click();await page.getByLabel('Condition 1 value').fill('spam');await save();
  await page.getByRole('button',{name:'New'}).click();await page.getByRole('button',{name:'Highlight author'}).click();await page.getByLabel('Condition 1 value').fill('Ada');await save();
  await page.getByRole('button',{name:'New'}).click();await page.getByRole('button',{name:'Feature folder'}).click();await save();
  await page.getByRole('button',{name:'New'}).click();await page.getByLabel('Rule name').fill('Star design');await page.getByLabel('Condition 1 value').fill('design');await save();
  await page.getByRole('button',{name:'New'}).click();await page.getByLabel('Rule name').fill('Read news');await page.getByLabel('Condition 1 value').fill('news');await page.getByLabel('Action 1',{exact:true}).selectOption('mark_read');await save();expect(service.list()).toHaveLength(5);
  const insert=(guid:string,title:string,author:string|null)=>database.db.insert(articles).values({feedId:feed.id,guid,url:`https://rules-exit.test/${guid}`,title,author,publishedAt:new Date(),hash:guid}).returning().get();const spam=insert('spam','Spam offer',null);const ada=insert('ada','An essay','Ada');const design=insert('design','Design systems',null);const news=insert('news','Morning news',null);for(const article of [spam,ada,design,news])await service.evaluateArticle(article.id);const states=database.db.select().from(articles).all();expect(states.find((item)=>item.id===spam.id)).toMatchObject({hidden:true,featuredInBrew:true});expect(states.find((item)=>item.id===ada.id)).toMatchObject({highlightColor:'#f59e0b',featuredInBrew:true});expect(states.find((item)=>item.id===design.id)?.starredAt).not.toBeNull();expect(states.find((item)=>item.id===news.id)?.readAt).not.toBeNull();database.close()});
