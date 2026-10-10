import { CallHandler, ConflictException, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { finalize } from 'rxjs';
import { readUploadLimits } from './config';

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

export type UploadLimits = ReturnType<typeof readUploadLimits>;
type UploadDatabase = Pick<PrismaClient, '$transaction' | 'upload'>;
type UploadIo = Pick<typeof filesystem, 'mkdir' | 'open' | 'unlink' | 'lstat'>;

function unavailable(code: string, message: string) {
  return new ServiceUnavailableException({ statusCode: 503, code, message });
}

/** Reserve normalized bytes before creating a file, serialized across API instances. */
export async function reserveUpload(db: Pick<PrismaClient, '$transaction'>, ownerId: string, filename: string, bytes: bigint, limits: UploadLimits) {
  try {
    await db.$transaction(async tx => {
      const owners = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id=${ownerId} FOR UPDATE`;
      if (!owners.length) throw new UnauthorizedException('Account is no longer available');
      // No state predicate: both incomplete reservations and usable files count.
      const usage = await tx.upload.aggregate({ where: { ownerId }, _sum: { bytes: true }, _count: { _all: true, bytes: true } });
      if (usage._count.bytes !== usage._count._all) {
        throw unavailable('UPLOAD_ACCOUNTING_UNAVAILABLE', 'Existing upload sizes need to be measured before you can add images. Contact an administrator.');
      }
      if (usage._count._all >= limits.files || (usage._sum.bytes ?? 0n) + bytes > limits.bytes) {
        throw new ConflictException({ statusCode: 409, code: 'UPLOAD_QUOTA_EXCEEDED', message: 'Your image storage limit has been reached. Contact an administrator.' });
      }
      await tx.upload.create({ data: { filename, ownerId, bytes, state: 'PENDING' } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw unavailable('UPLOAD_ACCOUNTING_UNAVAILABLE', 'Image storage accounting is temporarily unavailable. Please try again later.');
  }
}

async function releaseAbsentReservation(db: UploadDatabase, path: string, filename: string, ownerId: string, io: UploadIo) {
  try {
    await io.lstat(path);
    // Even a symlink or a failed exclusive create keeps its reservation charged.
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  // A database failure here is conservative: retain the charged reservation.
  await db.upload.deleteMany({ where: { filename, ownerId, state: 'PENDING' } }).catch(() => {
    logger.warn('An absent upload reservation could not be released; inspect upload storage accounting.');
  });
}

export async function persistUpload(db: UploadDatabase, directory: string, ownerId: string, buffer: Buffer, limits = readUploadLimits(), io: UploadIo = filesystem) {
  const filename = randomUUID() + '.webp';
  const path = join(directory, filename);
  await reserveUpload(db, ownerId, filename, BigInt(buffer.length), limits);
  let file: filesystem.FileHandle | undefined;
  try {
    await io.mkdir(directory, { recursive: true });
    // A failed exclusive open never authorizes removing a pre-existing file.
    file = await io.open(path, 'wx', 0o600);
    await file.writeFile(buffer);
    await file.close();
  } catch {
    if (file) {
      await file.close().catch(() => {});
      await io.unlink(path).catch(() => {
        logger.warn('An incomplete upload could not be removed; inspect upload storage health.');
      });
    }
    await releaseAbsentReservation(db, path, filename, ownerId, io);
    throw unavailable('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage is temporarily unavailable. Please try again later.');
  }
  try {
    await db.upload.update({ where: { filename, ownerId, state: 'PENDING' }, data: { state: 'READY' } });
  } catch {
    // The database may have committed READY before its acknowledgement failed.
    // Never unlink in this uncertain state. Both states remain quota-charged.
    throw unavailable('UPLOAD_STORAGE_UNAVAILABLE', 'Image storage is temporarily unavailable. Please try again later.');
  }
  return { url: '/api/uploads/' + filename };
}
