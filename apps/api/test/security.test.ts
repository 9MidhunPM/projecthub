import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword,verifyPassword,ensureOwner,ensureReviewer,ensureVisible,DUMMY_PASSWORD_HASH } from '../src/security';
test('passwords use random salt and verify without storing plaintext',async()=>{const a=await hashPassword('safe-password-123');const b=await hashPassword('safe-password-123');assert.notEqual(a,b);assert(await verifyPassword('safe-password-123',a));assert.equal(await verifyPassword('wrong-password',a),false);});
test('ownership cannot be bypassed by administrator role',()=>{assert.throws(()=>ensureOwner({ownerId:'owner'},{id:'other'}));ensureOwner({ownerId:'owner'},{id:'owner'});});
test('students cannot moderate and hidden projects are not public',()=>{assert.throws(()=>ensureReviewer({role:'STUDENT'}));ensureReviewer({role:'FACULTY'});assert.throws(()=>ensureVisible({status:'PENDING',ownerId:'owner'}));assert.throws(()=>ensureVisible({status:'HIDDEN',ownerId:'owner'},{id:'other',role:'STUDENT'}));ensureVisible({status:'PENDING',ownerId:'owner'},{id:'owner',role:'STUDENT'});ensureVisible({status:'PENDING',ownerId:'owner'},{id:'reviewer',role:'FACULTY'});});
test('malformed stored password hashes fail closed without accepting suffixes or truncated hex',async()=>{
 const valid=await hashPassword('safe-password-123');
 for(const stored of ['', ':', valid+':ignored', valid.slice(0,-1), valid+'gg', 'x'.repeat(32)+':'+ '0'.repeat(128)]) {
  assert.equal(await verifyPassword('safe-password-123',stored),false);
 }
 assert.equal(await verifyPassword('safe-password-123',DUMMY_PASSWORD_HASH),false);
});
