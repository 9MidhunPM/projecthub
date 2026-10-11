import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { User } from '@prisma/client';
import { Db } from './db';
import { sessionTokenId } from './security';
const authResolution = Symbol('authResolution');
export type AuthRequest = Request & { user?:User; sessionId?:string; [authResolution]?:Promise<void> };
export const userSelect={id:true,name:true,email:true,role:true,department:true,semester:true,bio:true,createdAt:true} as const;
export const publicUserSelect={id:true,name:true,department:true,semester:true,bio:true} as const;
@Injectable()
export class AuthService {
 constructor(private db:Db){}
 async resolve(req:AuthRequest){
  // Guards and controllers share one identity snapshot per request. Cache the
  // promise too so concurrent readers cannot observe half-resolved identity.
  req[authResolution] ??= this.resolveSession(req);
  await req[authResolution];
 }
 private async resolveSession(req:AuthRequest){
  delete req.user;
  delete req.sessionId;
  const id=sessionTokenId(req.cookies?.ph_session);
  if(!id) return;
  const session=await this.db.session.findUnique({where:{id},include:{user:true}});
  if(!session || session.expiresAt.getTime()<=Date.now()) return;
  req.user=session.user; req.sessionId=id;
 }
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(private auth:AuthService){}
 async canActivate(ctx:ExecutionContext){const req=ctx.switchToHttp().getRequest<AuthRequest>();await this.auth.resolve(req); if(!req.user)throw new UnauthorizedException('Please sign in');return true;}
}
