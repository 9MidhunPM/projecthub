import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { User } from '@prisma/client';
import { Db } from './db';
import { digest } from './security';
export type AuthRequest = Request & { user?:User; sessionId?:string };
export const userSelect={id:true,name:true,email:true,role:true,department:true,semester:true,bio:true,createdAt:true} as const;
export const publicUserSelect={id:true,name:true,department:true,semester:true,bio:true} as const;
@Injectable()
export class AuthService {
 constructor(private db:Db){}
 async resolve(req:AuthRequest){
  const token=req.cookies?.ph_session;
  if(typeof token!=='string' || token.length!==64) return;
  const id=digest(token); const session=await this.db.session.findUnique({where:{id},include:{user:true}});
  if(!session || session.expiresAt<new Date()) return;
  req.user=session.user; req.sessionId=id;
 }
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(private auth:AuthService){}
 async canActivate(ctx:ExecutionContext){const req=ctx.switchToHttp().getRequest<AuthRequest>();await this.auth.resolve(req); if(!req.user)throw new UnauthorizedException('Please sign in');return true;}
}
