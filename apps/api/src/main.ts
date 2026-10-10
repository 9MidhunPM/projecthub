import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Request, Response, NextFunction, json } from 'express';
import { digest } from './security';
import { Db } from './db';
import { ApiController } from './controller';
import { AuthService, AuthGuard } from './auth';
import { readApiConfig } from './config';

@Module({ controllers: [ApiController], providers: [Db, AuthService, AuthGuard] })
export class AppModule {}

export async function bootstrap(options: { port?: number; host?: string } = {}) {
  // Fail configuration before creating database pools or installing hooks.
  const config = readApiConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  if (config.trustedProxies.length) app.set('trust proxy', config.trustedProxies);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Responses can contain private data and viewer-specific interaction flags.
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== config.origin) {
      return res.status(403).json({ statusCode: 403, message: 'Untrusted request origin' });
    }
    next();
  });

  const rateLimitOptions = {
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    message: { statusCode: 429, message: 'Too many requests. Please try again later.' },
  };
  app.use('/api', rateLimit({ ...rateLimitOptions, windowMs: 60000, limit: 240 }));
  app.use(cookieParser());
  // One explicit parser avoids implicit body-size or form-encoding behavior.
  app.use(json({ limit: '256kb' }));
  app.use((error: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    // Body-parser errors may carry the submitted body. Handle expected parser
    // failures here so default exception logging never prints credentials.
    if (error.type === 'entity.too.large') {
      return res.status(413).json({ statusCode: 413, message: 'JSON request body exceeds 256 KiB' });
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ statusCode: 400, message: 'Malformed JSON request body' });
    }
    if (error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
      return res.status(415).json({ statusCode: 415, message: 'Unsupported request encoding' });
    }
    next(error);
  });
  app.use('/api/auth/login', rateLimit({
    ...rateLimitOptions,
    windowMs: 15 * 60000,
    limit: 15,
    keyGenerator: req => digest(typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''),
  }));
  app.use(['/api/auth/login', '/api/auth/signup'], rateLimit({ ...rateLimitOptions, windowMs: 15 * 60000, limit: 40 }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  try {
    await app.listen(options.port ?? config.port, options.host ?? '0.0.0.0');
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (require.main === module) bootstrap().catch(error => { console.error(error); process.exit(1); });
