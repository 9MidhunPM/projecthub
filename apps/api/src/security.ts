import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password:string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password,salt,64) as Buffer).toString('hex')}`; }
export async function verifyPassword(password:string, stored:string) { const [salt,hash]=stored.split(':'); if(!salt || !hash) return false; const expected=Buffer.from(hash,'hex'); const actual=await scrypt(password,salt,64) as Buffer; return expected.length===actual.length && timingSafeEqual(expected,actual); }
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function ensureOwner(project:{ownerId:string}, user:{id:string}) { if(project.ownerId!==user.id) throw new ForbiddenException('Only the project owner can edit this project'); }
export function ensureReviewer(user:{role:string}) { if(!['FACULTY','ADMIN'].includes(user.role)) throw new ForbiddenException('Reviewer access required'); }
export function ensureVisible(project:{status:string;ownerId:string}, user?:{id:string;role:string}|null) { if(project.status!=='APPROVED' && project.ownerId!==user?.id && !['FACULTY','ADMIN'].includes(user?.role||'')) throw new NotFoundException('Project not found'); }

export const secureCookie = process.env.NODE_ENV === 'production' && !(process.env.COOKIE_SECURE === 'false' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.WEB_ORIGIN || ''));
