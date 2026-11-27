import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { createApp } from '../dist/targets/node/src/app.js';
import { openDatabase } from '../dist/targets/node/src/db/database.js';

export async function verifyReaderSyncBuild() {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, logger: false });
  try {
    assert.equal((await app.inject('/api/capabilities')).json().readerApi, false);
    const configured = await app.inject({
      method: 'POST',
      url: '/api/reader-access',
      headers: { origin: 'http://localhost' },
      payload: { username: 'compiled-reader' },
    });
    assert.equal(configured.statusCode, 200);
    const credentials = configured.json();
    const setup = (await app.inject('/api/reader-access')).json();
    assert.equal(setup.googleReaderUrl, 'http://localhost/api/greader');
    assert.equal(setup.feverUrl, 'http://localhost/api/fever');
    const settingsTwin = await app.inject('/settings/apps.json');
    assert.equal(settingsTwin.statusCode, 200);
    assert.equal(settingsTwin.json().kind, 'reader-apps');
    assert.ok(!settingsTwin.body.includes(credentials.password));
    assert.equal((await app.inject('/api/capabilities')).json().readerApi, true);
    assert.match((await app.inject('/llms.txt')).body, /Google Reader/);
    database.sqlite.exec(
      "INSERT INTO feeds(url,title) VALUES('https://compiled-reader.test/rss','Compiled Reader'); INSERT INTO articles(id,feed_id,guid,hash,title,url,published_at,content_html) VALUES(4294967301,1,'compiled','compiled','Built entry','https://compiled-reader.test/entry',1,'<p>Built content.</p>')",
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/greader/accounts/ClientLogin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        Email: credentials.username,
        Passwd: credentials.password,
      }).toString(),
    });
    assert.equal(login.statusCode, 200);
    const authorization = `GoogleLogin auth=${/^Auth=(.+)$/m.exec(login.body)[1]}`;
    const prefix = '/api/greader/reader/api/0';
    const ids = await app.inject({ url: `${prefix}/stream/items/ids`, headers: { authorization } });
    assert.equal(ids.json().itemRefs[0].id, '4294967301');
    const contents = await app.inject({
      url: `${prefix}/stream/items/contents?i=4294967301`,
      headers: { authorization },
    });
    assert.equal(contents.json().items[0].id, 'tag:google.com,2005:reader/item/0000000100000005');
    assert.match(contents.json().items[0].summary.content, /Built content/);
    const T = (await app.inject({ url: `${prefix}/token`, headers: { authorization } })).body;
    const write = await app.inject({
      method: 'POST',
      url: `${prefix}/edit-tag`,
      headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams([
        ['T', T],
        ['i', contents.json().items[0].id],
        ['a', 'user/-/state/com.google/read'],
        ['a', 'user/-/state/com.google/starred'],
      ]).toString(),
    });
    assert.equal(write.statusCode, 200);
    const key = createHash('md5')
      .update(`${credentials.username}:${credentials.password}`)
      .digest('hex');
    const fever = await app.inject({
      method: 'POST',
      url: '/api/fever/?api&items&saved_item_ids',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ api_key: key }).toString(),
    });
    assert.equal(fever.json().auth, 1);
    assert.equal(fever.json().items[0].is_read, 1);
    assert.equal(fever.json().saved_item_ids, '4294967301');
    const stored = JSON.stringify(database.sqlite.prepare('SELECT * FROM reader_access').get());
    assert.ok(!stored.includes(credentials.password) && !stored.includes(key));
    assert.equal(
      (await app.inject({ url: '/api/feeds', headers: { authorization } })).statusCode,
      403,
    );
    await app.inject({
      method: 'DELETE',
      url: '/api/reader-access',
      headers: { origin: 'http://localhost' },
    });
    assert.equal(
      (await app.inject({ url: `${prefix}/subscription/list`, headers: { authorization } }))
        .statusCode,
      401,
    );
    assert.equal((await app.inject('/api/capabilities')).json().readerApi, false);
  } finally {
    await app.close();
  }
}
