import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { isIP } from 'node:net';
import { Request, Response, NextFunction, json } from 'express';
import { digest } from './security';
import { Db } from './db';
import { ApiController, uploadDir } from './controller';
import { AuthService, AuthGuard } from './auth';
@Module({controllers:[ApiController],providers:[Db,AuthService,AuthGuard]})
export class AppModule {}
export async function bootstrap(){
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{bodyParser:true});
 const trustedProxies=(process.env.TRUST_PROXY_IPS||'').split(',').map(s=>s.trim()).filter(Boolean);if(trustedProxies.some(ip=>!isIP(ip)))throw new Error('TRUST_PROXY_IPS must contain explicit IP addresses');if(trustedProxies.length)app.set('trust proxy',trustedProxies);
 app.setGlobalPrefix('api');app.use(helmet());app.use(cookieParser());app.use(json({limit:'256kb'}));
 const origin=process.env.WEB_ORIGIN||'http://localhost:3000';
 if(process.env.NODE_ENV==='production'&&!process.env.WEB_ORIGIN)throw new Error('WEB_ORIGIN is required in production');
 app.use((req:Request,res:Response,next:NextFunction)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({statusCode:403,message:'Untrusted request origin'});next();});
 app.use('/api',rateLimit({windowMs:60000,limit:240,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api/auth/login',rateLimit({windowMs:15*60000,limit:15,keyGenerator:(req)=>digest(String(req.body?.email||'').trim().toLowerCase()),standardHeaders:'draft-8',legacyHeaders:false}));
 app.use(['/api/auth/login','/api/auth/signup'],rateLimit({windowMs:15*60000,limit:40,standardHeaders:'draft-8',legacyHeaders:false}));

 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 app.enableShutdownHooks();await app.listen(Number(process.env.PORT)||4000,'0.0.0.0');return app;
}
if(require.main===module)bootstrap().catch(error=>{console.error(error);process.exit(1);});
