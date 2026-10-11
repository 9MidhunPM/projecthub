import { Prisma, PrismaClient } from '@prisma/client';
import { publicUserSelect } from './auth';

export const projectInclude = {
  owner: { select: publicUserSelect },
  _count: { select: { likes: true, bookmarks: true } },
} satisfies Prisma.ProjectInclude;

export type ProjectWithCounts = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** Fetch viewer flags once per collection, rather than twice per project. */
export async function shapeProjects(
  db: Pick<PrismaClient, 'like' | 'bookmark'>,
  projects: ProjectWithCounts[],
  userId?: string,
) {
  const projectIds = projects.map(project => project.id);
  const [likes, bookmarks] = userId && projectIds.length ? await Promise.all([
    db.like.findMany({ where: { userId, projectId: { in: projectIds } }, select: { projectId: true } }),
    db.bookmark.findMany({ where: { userId, projectId: { in: projectIds } }, select: { projectId: true } }),
  ]) : [[], []];
  const likedIds = new Set(likes.map(like => like.projectId));
  const bookmarkedIds = new Set(bookmarks.map(bookmark => bookmark.projectId));
  return projects.map(({ _count, ...project }) => ({
    ...project,
    likes: _count.likes,
    bookmarks: _count.bookmarks,
    liked: likedIds.has(project.id),
    bookmarked: bookmarkedIds.has(project.id),
  }));
}
