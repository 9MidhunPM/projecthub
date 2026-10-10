import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commaSeparated, projectPayload, ProjectForm, validateProjectForm} from '../lib/project-form';

const valid: ProjectForm = {title: 'Campus ideas', description: 'A helpful project for our student community.', department: 'Computer Science', semester: '2', type: 'Web Application', techStack: 'React, TypeScript', teamMembers: 'A Student', githubUrl: '', demoUrl: ''};

test('project metadata is normalized without changing interior text', () => {
  const payload = projectPayload({...valid, title: '  Campus ideas  ', techStack: ' React, ,TypeScript, '}, ['/api/uploads/image.webp']);
  assert.equal(payload.title, 'Campus ideas');
  assert.deepEqual(payload.techStack, ['React', 'TypeScript']);
  assert.equal(payload.semester, 2);
  assert.equal(payload.demoUrl, '');
  assert.deepEqual(commaSeparated('  '), []);
});

test('validation checks trimmed lengths and numeric semester bounds', () => {
  assert.equal(validateProjectForm(valid), null);
  assert.match(validateProjectForm({...valid, title: '  a  '})!, /3–120/);
  assert.match(validateProjectForm({...valid, description: ' '.repeat(30)})!, /20–20,000/);
  assert.match(validateProjectForm({...valid, semester: '13'})!, /semester/);
});

test('comma-separated fields enforce API item count and length limits', () => {
  assert.match(validateProjectForm({...valid, techStack: ', , '})!, /at least one/);
  assert.match(validateProjectForm({...valid, techStack: Array(21).fill('React').join(',')})!, /20 technologies/);
  assert.match(validateProjectForm({...valid, techStack: 'a'.repeat(41)})!, /40 characters/);
  assert.match(validateProjectForm({...valid, teamMembers: 'a'.repeat(81)})!, /80 characters/);
});

test('optional links support HTTP(S) but reject other schemes and whitespace', () => {
  assert.equal(validateProjectForm({...valid, demoUrl: ' https://example.com/demo?x=1 ' }), null);
  for (const demoUrl of ['javascript:alert(1)', 'ftp://example.com', 'https://example.com/a b', 'https://']) {
    assert.match(validateProjectForm({...valid, demoUrl})!, /http:\/\//);
  }
});
