import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
const { assertTestDatabaseUrl } = require('../../../scripts/test-database.cjs');

test('real PostgreSQL: signup, ownership, moderation, idempotency and origin protection',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 // Validate before opening a database connection or starting the API. A normal
 // development DATABASE_URL must never opt users into destructive test cleanup.
 const databaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
 const previous = { DATABASE_URL: process.env.DATABASE_URL, WEB_ORIGIN: process.env.WEB_ORIGIN, UPLOAD_DIR: process.env.UPLOAD_DIR };
 const temporaryUploads = await mkdtemp(join(tmpdir(), 'projecthub-api-test-'));
 process.env.DATABASE_URL = databaseUrl;
 process.env.WEB_ORIGIN = 'http://localhost:3000';
 process.env.UPLOAD_DIR = temporaryUploads;
 const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
 let app: NestExpressApplication | undefined;
 let baseUrl = '';
 const suffix=randomUUID();const created:string[]=[];let uploaded='';
 async function request(path:string,method='GET',body?:unknown,cookie='',origin='http://localhost:3000'){const r=await fetch(baseUrl+'/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
 async function signup(label:string){const r=await request('/auth/signup','POST',{name:label,email:`${label}-${suffix}@test.example`,password:'a-secure-test-password',department:'Computer Science',semester:4});assert.equal(r.status,201);created.push(r.data.id);return r;}
 try{
 const { bootstrap } = await import('../dist/main');
 app = await bootstrap({ port: 0, host: '127.0.0.1' });
 baseUrl = await app.getUrl();
 assert.deepEqual((await request('/health')).data,{ok:true});
 const readiness = await fetch(baseUrl+'/api/health/ready');
 assert.equal(readiness.status,200);
 assert.equal(readiness.headers.get('cache-control'),'no-store');
 assert.deepEqual(await readiness.json(),{ok:true,database:'up'});
 assert.equal((await fetch(baseUrl+'/api/auth/me')).headers.get('cache-control'),'no-store');
 assert.equal((await request('/auth/login','POST',{email:'missing@example.test',password:'x'.repeat(128*1024)})).status,400);
 assert.equal((await request('/auth/login','POST',{email:'missing@example.test',password:'x'.repeat(300*1024)})).status,413);
 const malformed = await fetch(baseUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{'});
 assert.equal(malformed.status,403);
 const malformedTrusted = await fetch(baseUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},body:'{"password":"sensitive-password",'});
 assert.equal(malformedTrusted.status,400);
 assert.deepEqual(await malformedTrusted.json(),{statusCode:400,message:'Malformed JSON request body'});
 const a=await signup('Owner'),b=await signup('Other'),reviewer=await signup('Reviewer'),admin=await signup('Admin');await db.user.update({where:{id:admin.data.id},data:{role:'ADMIN'}});await db.user.update({where:{id:reviewer.data.id},data:{role:'FACULTY'}});
 assert.equal((await request('/auth/signup','POST',{name:'Attack',email:`attack-${suffix}@test.example`,password:'a-secure-test-password',department:'CS',semester:1,role:'ADMIN'})).status,400);
 assert.equal((await request('/auth/login','POST',{email:`Owner-${suffix}@test.example`,password:'a-secure-test-password'},'','https://evil.example')).status,403);
 for (const query of ['q=a&q=b', 'department=a&department=b', 'page=1.5', 'page=Infinity', 'limit=49', 'semester=13', 'sort=unknown']) {
  assert.equal((await request('/projects?' + query)).status, 400, query);
 }
 const body={title:'Integration project',description:'This project is created for integration testing of ownership and moderation.',department:'Computer Science',semester:4,type:'Web Application',techStack:['TypeScript'],teamMembers:['Owner']};
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();const form=new FormData();form.append('file',new Blob([new Uint8Array(image)],{type:'image/png'}),'../../unsafe.png');const uploadResponse=await fetch(baseUrl+'/api/uploads',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:a.cookie},body:form});assert.equal(uploadResponse.status,201);uploaded=(await uploadResponse.json()).url;assert.match(uploaded,/^\/api\/uploads\/[a-f0-9-]+\.webp$/);assert.equal((await fetch(baseUrl+uploaded)).status,404);
 const p=await request('/projects','POST',{...body,screenshots:[uploaded]},a.cookie);assert.equal(p.status,201);const id=p.data.id;
 assert.equal((await request('/projects/'+id)).status,404);
 assert.equal((await request('/projects/'+id,'PATCH',body,b.cookie)).status,404);
 assert.equal((await request('/moderation/projects/'+id,'PATCH',{status:'HIDDEN'},reviewer.cookie)).status,400);
 assert.equal((await request('/moderation/projects','GET',undefined,a.cookie)).status,403);
 assert.equal((await request('/admin/users','GET',undefined,reviewer.cookie)).status,403);
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'FACULTY'},a.cookie)).status,403);
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'FACULTY'},admin.cookie)).data.role,'FACULTY');
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'STUDENT'},admin.cookie)).data.role,'STUDENT');
 assert.equal((await request('/admin/users/'+admin.data.id+'/role','PATCH',{role:'STUDENT'},admin.cookie)).status,400);
 assert.equal((await request('/projects','POST',{...body,githubUrl:'javascript:alert(1)'},a.cookie)).status,400);
 assert.equal((await request('/projects','POST',{...body,screenshots:[uploaded]},b.cookie)).status,400);
 const unsafeForm=new FormData();unsafeForm.append('file',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],{type:'image/svg+xml'}),'x.svg');assert.equal((await fetch(baseUrl+'/api/uploads',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:a.cookie},body:unsafeForm})).status,400);
 const submissions=await Promise.all([request('/projects/'+id+'/submit','POST',{},a.cookie),request('/projects/'+id+'/submit','POST',{},a.cookie)]);
 assert.equal(submissions.filter(result=>result.status===201).length,1);
 assert(submissions.some(result=>[400,409].includes(result.status)));
 assert.equal((await db.project.findUniqueOrThrow({where:{id}})).version,1);
 assert.equal((await request('/projects')).data.items.some((p:any)=>p.id===id),false);
 assert.equal((await request('/moderation/projects/'+id,'PATCH',{status:'CHANGES_REQUESTED'},reviewer.cookie)).status,400);
 const approvals=await Promise.all([request('/moderation/projects/'+id,'PATCH',{status:'APPROVED'},reviewer.cookie),request('/moderation/projects/'+id,'PATCH',{status:'APPROVED'},reviewer.cookie)]);
 assert.equal(approvals.filter(result=>result.status===200).length,1);
 assert(approvals.some(result=>[400,409].includes(result.status)));
 assert.equal(await db.audit.count({where:{targetId:id,action:'MODERATE_PROJECT'}}),1);
 assert.equal((await db.project.findUniqueOrThrow({where:{id}})).version,2);
 assert.equal((await fetch(baseUrl+uploaded)).status,200);
 const publicProject=await request('/projects/'+id);assert.equal(publicProject.status,200);assert.equal(publicProject.data.owner.email,undefined);
 const view=await request('/projects/'+id+'/view','POST',{});assert.equal(view.data.views,1);assert.equal((await request('/projects/'+id+'/view','POST',{},view.cookie)).data.views,1);
 assert.equal((await db.project.findUniqueOrThrow({where:{id}})).version,2);
 for(let i=0;i<2;i++)assert.equal((await request('/projects/'+id+'/like','PUT',{},b.cookie)).data.likes,1);
 for(let i=0;i<2;i++)assert.equal((await request('/projects/'+id+'/bookmark','PUT',{},b.cookie)).data.bookmarked,true);
 assert.equal((await request('/projects/'+id,'PATCH',body,a.cookie)).data.status,'DRAFT');assert.equal((await request('/projects/'+id)).status,404);
 assert.equal((await request('/auth/logout','POST',{},a.cookie)).status,201);assert.equal((await request('/auth/me','GET',undefined,a.cookie)).status,401);
 assert.equal((await request('/auth/logout','POST',{},a.cookie)).status,201);
 assert.equal((await request('/auth/logout','POST',{})).cookie,'ph_session=');
 }finally{
  try {
   await app?.close();
   await db.upload.deleteMany({where:{ownerId:{in:created}}});
   await db.audit.deleteMany({where:{actorId:{in:created}}});
   await db.user.deleteMany({where:{id:{in:created}}});
  } finally {
   await db.$disconnect();
   await rm(temporaryUploads,{recursive:true,force:true});
   for(const [key,value] of Object.entries(previous)) {
    if(value===undefined) delete process.env[key]; else process.env[key]=value;
   }
  }
 }
});
