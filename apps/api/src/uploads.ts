import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { finalize } from 'rxjs';

const logger = new Logger('Uploads');

/** Keep memory-backed multipart parsing and native image decoding bounded. */
@Injectable()
export class UploadCapacityInterceptor implements NestInterceptor {
  private active = 0;
  intercept(context: ExecutionContext, next: CallHandler) {
    if (this.active >= 2) {
      context.switchToHttp().getResponse().setHeader('Retry-After', '1');
      throw new ServiceUnavailableException('Image processing is busy. Please try again.');
    }
    this.active++;
    try {
      return next.handle().pipe(finalize(() => { this.active--; }));
    } catch (error) {
      this.active--;
      throw error;
    }
  }
}

export async function persistUpload(db: Pick<PrismaClient, 'upload'>, directory: string, ownerId: string, buffer: Buffer) {
  await mkdir(directory, { recursive: true });
  const filename = randomUUID() + '.webp';
  const path = join(directory, filename);
  // Opening exclusively first proves ownership of this path; a failed open
  // never authorizes deleting a pre-existing file.
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(buffer);
    await file.close();
    await db.upload.create({ data: { filename, ownerId } });
    return { url: '/api/uploads/' + filename };
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(path).catch(() => { logger.warn('An incomplete upload could not be removed; check upload storage health.'); });
    throw error;
  }
}
