import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password:string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password,salt,64) as Buffer).toString('hex')}`; }
export const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
export async function verifyPassword(password:string, stored:string) {
 if(!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
 const [salt,hash]=stored.split(':');
 const expected=Buffer.from(hash,'hex');
 const actual=await scrypt(password,salt,64) as Buffer;
 return timingSafeEqual(expected,actual);
}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function ensureOwner(project:{ownerId:string}, user:{id:string}) { if(project.ownerId!==user.id) throw new ForbiddenException('Only the project owner can edit this project'); }
export function ensureReviewer(user:{role:string}) { if(!['FACULTY','ADMIN'].includes(user.role)) throw new ForbiddenException('Reviewer access required'); }
export function ensureVisible(project:{status:string;ownerId:string}, user?:{id:string;role:string}|null) { if(project.status!=='APPROVED' && project.ownerId!==user?.id && !['FACULTY','ADMIN'].includes(user?.role||'')) throw new NotFoundException('Project not found'); }

export function sessionTokenId(token: unknown): string | undefined {
 if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return undefined;
 return digest(token);
}

export function secureCookie(environment: NodeJS.ProcessEnv = process.env): boolean {
 if (environment.COOKIE_SECURE === 'true') return true;
 const localHttp = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(environment.WEB_ORIGIN || '');
 return environment.NODE_ENV === 'production' && !(environment.COOKIE_SECURE === 'false' && localHttp);
}
