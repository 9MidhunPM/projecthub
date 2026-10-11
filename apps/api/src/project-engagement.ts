import { NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

function couldBeDeletedProject(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2025') return error.meta?.modelName === 'Project';
  if (error.code !== 'P2003') return false;
  const model = error.meta?.modelName;
  return typeof model === 'string' && ['Like', 'Bookmark', 'ViewEvent'].includes(model)
    && error.meta?.constraint === `${model}_projectId_fkey`;
}

/** Normalize only confirmed project disappearance, never unrelated DB failures. */
export async function guardEngagementWrite<T>(db: Pick<PrismaClient, 'project'>, projectId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!couldBeDeletedProject(error)) throw error;
    let project;
    try {
      project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    } catch {
      // A failed confirmation does not prove absence. Preserve the write error.
      throw error;
    }
    if (!project) throw new NotFoundException('Project not found');
    throw error;
  }
}
