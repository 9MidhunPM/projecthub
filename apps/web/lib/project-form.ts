import type {Project} from './api';

export type ProjectForm = {
  title: string;
  description: string;
  department: string;
  semester: string;
  type: string;
  techStack: string;
  teamMembers: string;
  githubUrl: string;
  demoUrl: string;
};

export function projectToForm(project: Project): ProjectForm {
  return {
    title: project.title, description: project.description, department: project.department,
    semester: String(project.semester), type: project.type, techStack: project.techStack.join(', '),
    teamMembers: project.teamMembers.join(', '), githubUrl: project.githubUrl ?? '', demoUrl: project.demoUrl ?? '',
  };
}

export function commaSeparated(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

export function projectPayload(form: ProjectForm, screenshots: string[]) {
  return {
    title: form.title.trim(), description: form.description.trim(), department: form.department.trim(),
    semester: Number(form.semester), type: form.type.trim(), techStack: commaSeparated(form.techStack),
    teamMembers: commaSeparated(form.teamMembers), githubUrl: form.githubUrl.trim(), demoUrl: form.demoUrl.trim(), screenshots,
  };
}

export function validateProjectForm(form: ProjectForm): string | null {
  const value = projectPayload(form, []);
  if (value.title.length < 3 || value.title.length > 120) return 'Use 3–120 characters for your project title, excluding spaces at the ends.';
  if (value.description.length < 20 || value.description.length > 20000) return 'Describe your project in 20–20,000 characters, excluding spaces at the ends.';
  if (value.department.length < 2 || value.department.length > 80) return 'Choose a department.';
  if (!Number.isInteger(value.semester) || value.semester < 1 || value.semester > 12) return 'Choose a semester from 1 to 12.';
  if (value.type.length < 2 || value.type.length > 60) return 'Choose a project type.';
  if (!value.techStack.length) return 'Add at least one technology, tool, or method used in your project.';
  if (value.techStack.length > 20 || value.techStack.some(item => item.length > 40)) return 'Add up to 20 technologies, using at most 40 characters for each.';
  if (value.teamMembers.length > 20 || value.teamMembers.some(item => item.length > 80)) return 'Add up to 20 team members, using at most 80 characters for each name.';
  for (const [label, url] of [['GitHub repository', value.githubUrl], ['Live demo', value.demoUrl]]) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || /\s/.test(url) || url.length > 2000) throw new Error();
    } catch {
      return `${label} must be a complete http:// or https:// URL, up to 2,000 characters.`;
    }
  }
  return null;
}
