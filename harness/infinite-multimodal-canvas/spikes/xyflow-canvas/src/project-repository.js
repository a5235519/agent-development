export class ProjectConflictError extends Error {
  constructor({ projectId, expectedRevision, actualRevision }) {
    super(`Project ${projectId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'ProjectConflictError';
    this.code = 'PROJECT_REVISION_CONFLICT';
    this.projectId = projectId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export const PROJECT_REPOSITORY_METHODS = Object.freeze([
  'listProjects',
  'getProject',
  'createProject',
  'saveDraft',
  'publishVersion',
  'restoreVersion',
]);

function clone(value) {
  return structuredClone(value);
}

export function createInMemoryProjectRepository({ seed = [], now = () => new Date().toISOString() } = {}) {
  const records = new Map(seed.map((project) => [project.id, { revision: 1, versions: [], ...clone(project) }]));

  function requireProject(projectId) {
    const project = records.get(projectId);
    if (!project) throw Object.assign(new Error(`Project not found: ${projectId}`), { code: 'PROJECT_NOT_FOUND' });
    return project;
  }

  function assertRevision(project, projectId, expectedRevision) {
    if (expectedRevision !== project.revision) {
      throw new ProjectConflictError({ projectId, expectedRevision, actualRevision: project.revision });
    }
  }

  return {
    async listProjects() {
      return [...records.values()].map(({ draft, versions, ...summary }) => clone({ ...summary, versionCount: versions.length }));
    },
    async getProject(projectId) {
      return clone(requireProject(projectId));
    },
    async createProject(input) {
      if (records.has(input.id)) throw Object.assign(new Error(`Project already exists: ${input.id}`), { code: 'PROJECT_ALREADY_EXISTS' });
      const timestamp = now();
      const project = { ...clone(input), revision: 1, versions: [], createdAt: timestamp, updatedAt: timestamp };
      records.set(project.id, project);
      return clone(project);
    },
    async saveDraft(projectId, draft, { expectedRevision }) {
      const project = requireProject(projectId);
      assertRevision(project, projectId, expectedRevision);
      project.draft = clone(draft);
      project.revision += 1;
      project.updatedAt = now();
      return clone(project);
    },
    async publishVersion(projectId, draft, { expectedRevision }) {
      const project = requireProject(projectId);
      assertRevision(project, projectId, expectedRevision);
      const version = { id: `${projectId}-v${project.versions.length + 1}`, number: project.versions.length + 1, publishedAt: now(), draft: clone(draft) };
      project.draft = clone(draft);
      project.versions.unshift(version);
      project.revision += 1;
      project.updatedAt = version.publishedAt;
      return { project: clone(project), version: clone(version) };
    },
    async restoreVersion(projectId, versionId, { expectedRevision }) {
      const project = requireProject(projectId);
      assertRevision(project, projectId, expectedRevision);
      const version = project.versions.find((item) => item.id === versionId);
      if (!version) throw Object.assign(new Error(`Version not found: ${versionId}`), { code: 'VERSION_NOT_FOUND' });
      project.draft = clone(version.draft);
      project.revision += 1;
      project.updatedAt = now();
      return clone(project);
    },
  };
}
