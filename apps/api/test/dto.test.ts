import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LoginDto, ProfileDto, ProjectDto, SignupDto, ModerationDto } from '../dist/dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (metatype: any, value: unknown) => pipe.transform(value, { type: 'body', metatype });
const project = {
  title: 'Example project', description: 'A complete description of this example project.',
  department: 'Computer Science', semester: 4, type: 'Web Application',
  techStack: ['TypeScript'], teamMembers: ['Student'],
};

test('optional DTO fields reject null instead of passing it to non-null database columns', async () => {
  for (const field of ['name', 'department', 'semester', 'bio']) {
    await assert.rejects(validate(ProfileDto, { [field]: null }), BadRequestException);
  }
  for (const field of ['githubUrl', 'demoUrl', 'screenshots']) {
    await assert.rejects(validate(ProjectDto, { ...project, [field]: null }), BadRequestException);
  }
  await assert.rejects(validate(ModerationDto, { status: 'APPROVED', feedback: null }), BadRequestException);
  assert(Object.values(await validate(ProfileDto, {})).every(value => value === undefined));
  await validate(ProjectDto, project);
  await validate(ModerationDto, { status: 'APPROVED' });
});

test('human-readable values are trimmed before minimum length validation', async () => {
  for (const field of ['title', 'description', 'department', 'type']) {
    await assert.rejects(validate(ProjectDto, { ...project, [field]: ' '.repeat(30) }), BadRequestException);
  }
  for (const field of ['techStack', 'teamMembers']) {
    await assert.rejects(validate(ProjectDto, { ...project, [field]: ['   '] }), BadRequestException);
  }
  const result = await validate(ProjectDto, { ...project, title: '  Example project  ', techStack: [' TypeScript '] });
  assert.equal(result.title, 'Example project');
  assert.deepEqual(result.techStack, ['TypeScript']);
});

test('auth DTO normalization preserves password whitespace and rejects blank signup names', async () => {
  const password = '  meaningful spaces  ';
  const login = await validate(LoginDto, { email: ' student@example.test ', password });
  assert.equal(login.email, 'student@example.test');
  assert.equal(login.password, password);
  await assert.rejects(validate(SignupDto, { ...login, name: '  ', department: 'CS', semester: 1 }), BadRequestException);
});

test('optional empty strings and explicit empty screenshot lists retain clear-field semantics', async () => {
  const result = await validate(ProjectDto, { ...project, githubUrl: '  ', demoUrl: '', screenshots: [] });
  assert.equal(result.githubUrl, '');
  assert.equal(result.demoUrl, '');
  assert.deepEqual(result.screenshots, []);
  assert.equal((await validate(ProfileDto, { bio: '  ' })).bio, '');
});
