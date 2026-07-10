import { describe,expect,it,vi } from 'vitest';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';
describe('security headers and image proxy',()=>{
  it('sets a restrictive CSP and proxies only HTTP image responses',async()=>{const fetcher=vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-type':'image/png'}})) as unknown as typeof fetch;const app=await createApp({database:openDatabase(':memory:'),fetcher});const health=await app.inject('/api/health');expect(health.headers['content-security-policy']).toContain("object-src 'none'");const image=await app.inject('/api/img?src=https%3A%2F%2Fimages.test%2Fhero.png');expect(image.statusCode).toBe(200);expect(image.headers['content-type']).toBe('image/png');expect(fetcher).toHaveBeenCalledOnce();expect((await app.inject('/api/img?src=file%3A%2F%2Fsecret')).statusCode).toBe(400);await app.close()});
});
