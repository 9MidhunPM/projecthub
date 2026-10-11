import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, Upload } from '@prisma/client';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModerationDto, ProjectDto, ProjectVersionDto, UpdateProjectDto } from './dto';
import { projectInclude, ProjectWithCounts } from './project-shape';
import { ensureExpectedVersion, ensureModerationTransition, guardProjectWrite } from './project-state';
import { ensureOwner, ensureReviewer, ensureVisible } from './security';

type Actor = { id: string; role: string };
type ProjectUpdate = { where: Prisma.ProjectWhereUniqueInput; data: Prisma.ProjectUpdateArgs['data']; include: typeof projectInclude };

/** The concrete persistence operations used by project commands, not a general repository. */
export interface ProjectCommandDatabase {
  project: {
    findUnique(query: { where: { id: string }; include: typeof projectInclude }): Promise<ProjectWithCounts | null>;
    create(query: { data: Prisma.ProjectCreateArgs['data']; include: typeof projectInclude }): Promise<ProjectWithCounts>;
    update(query: ProjectUpdate): Prisma.PrismaPromise<ProjectWithCounts>;
    delete(query: { where: Prisma.ProjectWhereUniqueInput }): Promise<unknown>;
  };
  upload: {
    findUnique(query: { where: { filename: string } }): Promise<Pick<Upload, 'ownerId' | 'state'> | null>;
  };
  audit: {
    create(query: { data: Prisma.AuditCreateArgs['data'] }): Prisma.PrismaPromise<unknown>;
  };
  $transaction(operations: [Prisma.PrismaPromise<ProjectWithCounts>, Prisma.PrismaPromise<unknown>]): Promise<[ProjectWithCounts, unknown]>;
}

type ProjectUploadIo = { stat(path: string): Promise<unknown> };

/** Authenticated project commands retain one caller identity and the observed version. */
export class ProjectCommands {
  constructor(private db: ProjectCommandDatabase, private uploadDirectory: string, private io: ProjectUploadIo = { stat }) {}

  private async project(id: string, actor: Actor) {
    const project = await this.db.project.findUnique({ where: { id }, include: projectInclude });
    if (!project) throw new NotFoundException('Project not found');
    ensureVisible(project, actor);
    return project;
  }

  private async validateContent(body: ProjectDto, userId: string) {
    for (const url of body.screenshots || []) {
      if (['/examples/campus-connect.png', '/examples/ecotrack.png', '/examples/study-space.png'].includes(url)) continue;
      try {
        const filename = url.split('/').pop()!;
        const upload = await this.db.upload.findUnique({ where: { filename } });
        if (!upload || upload.state !== 'READY' || upload.ownerId !== userId) throw Error();
        await this.io.stat(resolve(this.uploadDirectory, filename));
      } catch {
        throw new BadRequestException('Screenshot does not exist');
      }
    }
    for (const value of [body.githubUrl, body.demoUrl]) if (value) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
      } catch {
        throw new BadRequestException('Links must be valid HTTP or HTTPS URLs');
      }
    }
  }

  async create(body: ProjectDto, actor: Actor) {
    await this.validateContent(body, actor.id);
    return this.db.project.create({ data: { ...body, screenshots: body.screenshots || [], ownerId: actor.id }, include: projectInclude });
  }

  async update(id: string, body: UpdateProjectDto, actor: Actor) {
    const project = await this.project(id, actor);
    ensureOwner(project, actor);
    const { expectedVersion, ...changes } = body;
    ensureExpectedVersion(project, expectedVersion);
    await this.validateContent(changes, actor.id);
    return guardProjectWrite(() => this.db.project.update({
      where: { id, ownerId: actor.id, version: project.version, status: project.status },
      data: { ...changes, status: 'DRAFT', feedback: '', version: { increment: 1 } }, include: projectInclude,
    }));
  }

  async remove(id: string, body: ProjectVersionDto, actor: Actor) {
    const project = await this.project(id, actor);
    ensureOwner(project, actor);
    ensureExpectedVersion(project, body.expectedVersion);
    await guardProjectWrite(() => this.db.project.delete({ where: { id, ownerId: actor.id, version: project.version, status: project.status } }));
    return { ok: true };
  }

  async submit(id: string, body: ProjectVersionDto, actor: Actor) {
    const project = await this.project(id, actor);
    ensureOwner(project, actor);
    ensureExpectedVersion(project, body.expectedVersion);
    if (!['DRAFT', 'CHANGES_REQUESTED'].includes(project.status)) throw new BadRequestException('Only drafts or changes-requested projects can be submitted');
    return guardProjectWrite(() => this.db.project.update({
      where: { id, ownerId: actor.id, version: project.version, status: project.status },
      data: { status: 'PENDING', feedback: '', version: { increment: 1 } }, include: projectInclude,
    }));
  }

  async moderate(id: string, body: ModerationDto, actor: Actor) {
    ensureReviewer(actor);
    const current = await this.project(id, actor);
    if (current.ownerId === actor.id) throw new ForbiddenException('You cannot review your own project');
    ensureExpectedVersion(current, body.expectedVersion);
    ensureModerationTransition(current.status, body.status, body.feedback);
    const [project] = await guardProjectWrite(() => this.db.$transaction([
      this.db.project.update({
        where: { id, version: current.version, status: current.status },
        data: { status: body.status, feedback: body.feedback || '', version: { increment: 1 } }, include: projectInclude,
      }),
      this.db.audit.create({ data: { actorId: actor.id, action: 'MODERATE_PROJECT', targetId: id, details: JSON.stringify(body) } }),
    ]));
    return project;
  }
}
