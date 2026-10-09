'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const file = '/run/projecthub-secrets/postgres-password';
// Deterministic fixtures only. No actual credential or database is created.
function harness({existing=false, initialized=false, invalid=false}={}) {
  const files=new Map(); const handles=new Map(); const logs=[]; let counter=0,generated=0,exitCode;
  if(existing)files.set(file,{value:'a'.repeat(96),uid:0,gid:1000,mode:invalid?0o644:0o440});
  const noent=()=>Object.assign(new Error('missing'),{code:'ENOENT'});
  const fake={constants:fs.constants,mkdirSync(){},chownSync(){},chmodSync(){},existsSync(p){return files.has(p)||(initialized&&p.endsWith('/PG_VERSION'));},
    openSync(p,flags,mode){if(flags&fs.constants.O_CREAT){if(files.has(p))throw Object.assign(new Error('exists'),{code:'EEXIST'});files.set(p,{value:'',uid:0,gid:0,mode});}else{assert(flags&fs.constants.O_NOFOLLOW);if(!files.has(p))throw noent();}handles.set(++counter,p);return counter;},
    fstatSync(fd){return {...files.get(handles.get(fd)),isFile:()=>true};},readFileSync(fd){return files.get(handles.get(fd)).value;},
    writeFileSync(fd,value){files.get(handles.get(fd)).value=value;},fchownSync(fd,uid,gid){Object.assign(files.get(handles.get(fd)),{uid,gid});},fchmodSync(fd,mode){files.get(handles.get(fd)).mode=mode;},fsyncSync(){},closeSync(fd){handles.delete(fd);},
    linkSync(source,dest){if(files.has(dest))throw Object.assign(new Error('exists'),{code:'EEXIST'});files.set(dest,files.get(source));},unlinkSync(p){if(!files.delete(p))throw noent();}};
  const fakeProcess={env:{},argv:['node','wrapper'],on(){},exit(code){exitCode=code;},set exitCode(v){exitCode=v;}};
  const context={require(name){if(name==='node:fs')return fake;if(name==='node:crypto')return {randomUUID:()=> 'fixture-id',randomBytes(n){generated++;return Buffer.alloc(n,0xaa);}};throw Error('unexpected module');},console:{log:m=>logs.push(m),error:m=>logs.push(m)},process:fakeProcess};
  return {context,files,logs,fakeProcess,run(script='init-db-secret.cjs'){vm.runInNewContext(fs.readFileSync(path.join(__dirname,script),'utf8'),context);},get generated(){return generated;},get exitCode(){return exitCode;}};
}
test('fresh volume creates one private atomic credential without logging it',()=>{const h=harness();h.run();assert.equal(h.generated,1);assert.equal(h.exitCode,undefined);assert.equal(h.files.size,1);const secret=h.files.get(file);assert.equal(secret.mode,0o440);assert.equal(secret.uid,0);assert.equal(secret.gid,1000);assert.equal(secret.value.length,96);assert(!h.logs.join('').includes(secret.value));});
test('redeploy preserves credential without regeneration',()=>{const h=harness({existing:true,initialized:true});h.run();assert.equal(h.generated,0);assert.equal(h.exitCode,undefined);assert.equal(h.files.get(file).value,'a'.repeat(96));});
test('missing credential with existing database fails closed',()=>{const h=harness({initialized:true});h.run();assert.equal(h.exitCode,1);assert.equal(h.generated,0);assert.equal(h.files.size,0);});
test('unsafe existing permissions fail without replacement',()=>{const h=harness({existing:true,invalid:true});h.run();assert.equal(h.exitCode,1);assert.equal(h.generated,0);});
test('runtime wrapper supplies credential only to child environment',()=>{const h=harness({existing:true});h.fakeProcess.argv=['node','wrapper','npm','run','db:migrate'];let options,args;const original=h.context.require;h.context.require=name=>name==='node:child_process'?{spawn(command,rest,opts){args=[command,...rest];options=opts;return {on(){},kill(){}};}}:original(name);h.run('with-db-secret.cjs');assert.deepEqual(Array.from(args),['npm','run','db:migrate']);assert(options.env.DATABASE_URL.includes('a'.repeat(96)));assert(!JSON.stringify(args).includes('a'.repeat(96)));assert(!h.logs.join('').includes('a'.repeat(96)));assert.equal(h.exitCode,undefined);});
test('runtime wrapper rejects conflicting externally configured credentials',()=>{const h=harness({existing:true});h.fakeProcess.env.DATABASE_URL='configured-elsewhere';const original=h.context.require;h.context.require=name=>name==='node:child_process'?{spawn(){throw Error('must not spawn');}}:original(name);h.run('with-db-secret.cjs');assert.equal(h.exitCode,1);});
