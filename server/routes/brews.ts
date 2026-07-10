import type { FastifyInstance } from 'fastify';
import type { BrewConfigDraft } from '../../shared/brew.js';
import type { BrewDatabase } from '../db/database.js';
import { BrewService } from '../services/brew-service.js';
export function registerBrewRoutes(app:FastifyInstance,database:BrewDatabase){const service=new BrewService(database);
  app.get('/api/brew-configs',async()=>service.listConfigs());
  app.post<{Body:BrewConfigDraft}>('/api/brew-configs',async(req,reply)=>{try{return reply.code(201).send(service.create(req.body))}catch(e){return reply.code(400).send({error:e instanceof Error?e.message:'Invalid Brew'})}});
  app.put<{Params:{id:string};Body:BrewConfigDraft}>('/api/brew-configs/:id',async(req,reply)=>service.update(Number(req.params.id),req.body)??reply.code(404).send({error:'Brew not found'}));
  app.delete<{Params:{id:string}}>('/api/brew-configs/:id',async(req,reply)=>service.delete(Number(req.params.id))?reply.code(204).send():reply.code(404).send({error:'Brew not found'}));
  app.post<{Params:{id:string}}>('/api/brew-configs/:id/generate',async(req,reply)=>{try{return service.generate(Number(req.params.id))}catch(e){return reply.code(404).send({error:e instanceof Error?e.message:'Brew not found'})}});
  app.get<{Params:{id:string}}>('/api/brew-configs/:id/history',async(req)=>service.history(Number(req.params.id)));
  app.get<{Params:{id:string}}>('/api/brews/:id',async(req,reply)=>service.snapshot(Number(req.params.id))??reply.code(404).send({error:'Snapshot not found'}));
  app.put<{Params:{id:string};Body:{position:number}}>('/api/brews/:id/scroll',async(req)=>{service.saveScroll(Number(req.params.id),req.body.position);return {ok:true}});
}
