import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';

export async function guardProjectWrite<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2034'].includes(error.code)) {
      throw new ConflictException('This project changed while you were working. Reload it and try again.');
    }
    throw error;
  }
}

export function ensureModerationTransition(current: ProjectStatus, next: ProjectStatus, feedback?: string) {
  if (current === 'DRAFT') throw new BadRequestException('Submit the draft before reviewing it');
  if (next === 'APPROVED' && current !== 'PENDING') {
    throw new BadRequestException('Only pending projects can be approved');
  }
  if (next === 'HIDDEN' && current === 'HIDDEN') throw new BadRequestException('Project is already hidden');
  if (next === 'CHANGES_REQUESTED' && !feedback?.trim()) throw new BadRequestException('Feedback is required');
}
