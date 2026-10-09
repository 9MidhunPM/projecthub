import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bootstrap } from '../dist/main';
test('real PostgreSQL: signup, ownership, moderation, idempotency and origin protection',{skip:!process.env.DATABASE_URL},async()=>{
 process.env.PORT='4017';process.env.WEB_ORIGIN='http://localhost:3000';const app=await bootstrap();const db=new PrismaClient();const suffix=Date.now();const created:string[]=[];let uploaded='';
 async function request(path:string,method='GET',body?:unknown,cookie='',origin='http://localhost:3000'){const r=await fetch('http://127.0.0.1:4017/api'+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
 async function signup(label:string){const r=await request('/auth/signup','POST',{name:label,email:`${label}-${suffix}@test.example`,password:'a-secure-test-password',department:'Computer Science',semester:4});assert.equal(r.status,201);created.push(r.data.id);return r;}
 try{
 const a=await signup('Owner'),b=await signup('Other'),reviewer=await signup('Reviewer'),admin=await signup('Admin');await db.user.update({where:{id:admin.data.id},data:{role:'ADMIN'}});await db.user.update({where:{id:reviewer.data.id},data:{role:'FACULTY'}});
 assert.equal((await request('/auth/signup','POST',{name:'Attack',email:`attack-${suffix}@test.example`,password:'a-secure-test-password',department:'CS',semester:1,role:'ADMIN'})).status,400);
 assert.equal((await request('/auth/login','POST',{email:`Owner-${suffix}@test.example`,password:'a-secure-test-password'},'','https://evil.example')).status,403);
 const body={title:'Integration project',description:'This project is created for integration testing of ownership and moderation.',department:'Computer Science',semester:4,type:'Web Application',techStack:['TypeScript'],teamMembers:['Owner']};
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).png().toBuffer();const form=new FormData();form.append('file',new Blob([new Uint8Array(image)],{type:'image/png'}),'../../unsafe.png');const uploadResponse=await fetch('http://127.0.0.1:4017/api/uploads',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:a.cookie},body:form});assert.equal(uploadResponse.status,201);uploaded=(await uploadResponse.json()).url;assert.match(uploaded,/^\/api\/uploads\/[a-f0-9-]+\.webp$/);assert.equal((await fetch('http://127.0.0.1:4017'+uploaded)).status,404);
 const p=await request('/projects','POST',{...body,screenshots:[uploaded]},a.cookie);assert.equal(p.status,201);const id=p.data.id;
 assert.equal((await request('/projects/'+id)).status,404);
 assert.equal((await request('/projects/'+id,'PATCH',body,b.cookie)).status,404);
 assert.equal((await request('/moderation/projects','GET',undefined,a.cookie)).status,403);
 assert.equal((await request('/admin/users','GET',undefined,reviewer.cookie)).status,403);
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'FACULTY'},a.cookie)).status,403);
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'FACULTY'},admin.cookie)).data.role,'FACULTY');
 assert.equal((await request('/admin/users/'+b.data.id+'/role','PATCH',{role:'STUDENT'},admin.cookie)).data.role,'STUDENT');
 assert.equal((await request('/admin/users/'+admin.data.id+'/role','PATCH',{role:'STUDENT'},admin.cookie)).status,400);
 assert.equal((await request('/projects','POST',{...body,githubUrl:'javascript:alert(1)'},a.cookie)).status,400);
 assert.equal((await request('/projects','POST',{...body,screenshots:[uploaded]},b.cookie)).status,400);
 const unsafeForm=new FormData();unsafeForm.append('file',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],{type:'image/svg+xml'}),'x.svg');assert.equal((await fetch('http://127.0.0.1:4017/api/uploads',{method:'POST',headers:{Origin:'http://localhost:3000',Cookie:a.cookie},body:unsafeForm})).status,400);
 assert.equal((await request('/projects/'+id+'/submit','POST',{},a.cookie)).data.status,'PENDING');
 assert.equal((await request('/projects')).data.items.some((p:any)=>p.id===id),false);
 assert.equal((await request('/moderation/projects/'+id,'PATCH',{status:'CHANGES_REQUESTED'},reviewer.cookie)).status,400);
 assert.equal((await request('/moderation/projects/'+id,'PATCH',{status:'APPROVED'},reviewer.cookie)).data.status,'APPROVED');
 assert.equal((await fetch('http://127.0.0.1:4017'+uploaded)).status,200);
 const publicProject=await request('/projects/'+id);assert.equal(publicProject.status,200);assert.equal(publicProject.data.owner.email,undefined);
 const view=await request('/projects/'+id+'/view','POST',{});assert.equal(view.data.views,1);assert.equal((await request('/projects/'+id+'/view','POST',{},view.cookie)).data.views,1);
 for(let i=0;i<2;i++)assert.equal((await request('/projects/'+id+'/like','PUT',{},b.cookie)).data.likes,1);
 for(let i=0;i<2;i++)assert.equal((await request('/projects/'+id+'/bookmark','PUT',{},b.cookie)).data.bookmarked,true);
 assert.equal((await request('/projects/'+id,'PATCH',body,a.cookie)).data.status,'DRAFT');assert.equal((await request('/projects/'+id)).status,404);
 assert.equal((await request('/auth/logout','POST',{},a.cookie)).status,201);assert.equal((await request('/auth/me','GET',undefined,a.cookie)).status,401);
 }finally{if(uploaded){const filename=uploaded.split('/').pop()!;await db.upload.deleteMany({where:{filename}});await unlink(resolve(process.env.UPLOAD_DIR||'var/uploads',filename)).catch(()=>{});}await db.audit.deleteMany({where:{actorId:{in:created}}});await db.user.deleteMany({where:{id:{in:created}}});await db.$disconnect();await app.close();}
});
