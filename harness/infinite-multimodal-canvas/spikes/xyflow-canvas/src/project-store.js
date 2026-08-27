const DEFAULT_PROJECTS_KEY = 'multimodal-canvas-projects-xyflow-spike-v01';
const DEFAULT_ACTIVE_KEY = 'multimodal-canvas-active-project-xyflow-spike-v01';

function clone(value) {
  return structuredClone(value);
}

export function createMemoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

export function createProjectStore({
  storage,
  seedDraft,
  projectsKey = DEFAULT_PROJECTS_KEY,
  activeKey = DEFAULT_ACTIVE_KEY,
  now = () => new Date().toISOString(),
  createId = () => `project-${Date.now().toString(36)}`,
} = {}) {
  if (!storage) throw new Error('Project Store requires storage');
  if (!seedDraft) throw new Error('Project Store requires seedDraft');
  let projects = [];
  let activeProjectId = null;

  function normalize(project) {
    const timestamp = now();
    return {
      id: project.id,
      title: project.title || '未命名工程',
      description: project.description || '',
      createdAt: project.createdAt || timestamp,
      updatedAt: project.updatedAt || timestamp,
      draft: clone(project.draft || seedDraft),
      versions: Array.isArray(project.versions) ? clone(project.versions) : [],
      runs: Array.isArray(project.runs) ? clone(project.runs) : [],
      draftEvents: Array.isArray(project.draftEvents) ? clone(project.draftEvents) : [],
    };
  }

  function persist() {
    storage.setItem(projectsKey, JSON.stringify(projects));
    storage.setItem(activeKey, activeProjectId);
  }

  function load() {
    try {
      const saved = JSON.parse(storage.getItem(projectsKey) || '[]');
      projects = Array.isArray(saved) ? saved.filter((item) => item?.id).map(normalize) : [];
    } catch {
      projects = [];
    }
    if (!projects.length) {
      projects = [normalize({ id: 'project-xyflow-demo', title: 'XYFlow 验证工程', draft: seedDraft })];
    }
    const remembered = storage.getItem(activeKey);
    activeProjectId = projects.some((project) => project.id === remembered) ? remembered : projects[0].id;
    persist();
    return snapshot();
  }

  function current() {
    return projects.find((project) => project.id === activeProjectId) || null;
  }

  function snapshot() {
    return { activeProjectId, projects: clone(projects) };
  }

  function saveDraft(draft, { command = null } = {}) {
    const project = current();
    if (!project) throw new Error('Active project not found');
    project.draft = clone(draft);
    project.updatedAt = now();
    if (command) {
      project.draftEvents.push({
        id: command.id,
        type: command.type,
        meta: clone(command.meta || {}),
        createdAt: project.updatedAt,
      });
      project.draftEvents = project.draftEvents.slice(-100);
    }
    persist();
    return clone(project);
  }

  function createProject({ title, draft = seedDraft } = {}) {
    const project = normalize({
      id: createId(),
      title: title || `新工程 ${projects.length + 1}`,
      draft,
    });
    projects.push(project);
    activeProjectId = project.id;
    persist();
    return clone(project);
  }

  function switchProject(projectId) {
    if (!projects.some((project) => project.id === projectId)) throw new Error(`Project not found: ${projectId}`);
    activeProjectId = projectId;
    persist();
    return clone(current());
  }

  function publishVersion(draft) {
    const project = current();
    if (!project) throw new Error('Active project not found');
    const publishedAt = now();
    const snapshot = clone(draft);
    const version = {
      ...snapshot,
      workflowId: snapshot.id,
      id: `wv-${publishedAt.replace(/\D/g, '')}-${project.versions.length + 1}`,
      number: project.versions.length + 1,
      status: 'PUBLISHED',
      publishedAt,
    };
    project.versions.unshift(version);
    project.draft = clone(draft);
    project.updatedAt = publishedAt;
    persist();
    return clone(version);
  }

  function archiveRun(run) {
    const project = current();
    if (!project) throw new Error('Active project not found');
    if (!run?.id) throw new Error('Run requires id');
    const existingIndex = project.runs.findIndex((item) => item.id === run.id);
    if (existingIndex >= 0) project.runs.splice(existingIndex, 1);
    project.runs.unshift(clone(run));
    project.runs = project.runs.slice(0, 50);
    project.updatedAt = now();
    persist();
    return clone(project.runs[0]);
  }

  function restoreVersion(versionId) {
    const project = current();
    const version = project?.versions.find((item) => item.id === versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);
    const { id, number, status, publishedAt, workflowId, ...draft } = version;
    if (workflowId) draft.id = workflowId;
    project.draft = clone(draft);
    project.updatedAt = now();
    project.draftEvents.push({
      id: `restore-${versionId}-${project.updatedAt}`,
      type: '恢复版本',
      meta: { versionId, number },
      createdAt: project.updatedAt,
    });
    project.draftEvents = project.draftEvents.slice(-100);
    persist();
    return clone(project.draft);
  }

  return { load, current, snapshot, saveDraft, createProject, switchProject, publishVersion, archiveRun, restoreVersion };
}
