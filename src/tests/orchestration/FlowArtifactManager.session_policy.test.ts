import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FlowArtifactManager } from '../../orchestration/flow-artifact-manager.js';

describe('FlowArtifactManager session policy persistence', () => {
  it('persists and restores session policy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-persist-'));
    const persistPath = path.join(root, 'flow-artifacts');

    const manager = new FlowArtifactManager({ persistPath, autoPersist: true });
    const sessionId = manager.resolveSessionId('new', 'policy intent');
    expect(sessionId).toBeDefined();

    manager.updateSessionPolicy(sessionId as string, { profile: 'deep', sources: 'docs' }, 'merge');

    const restored = new FlowArtifactManager({ persistPath, autoPersist: true });
    await restored.restoreAll();

    const session = restored.getSession(sessionId as string);
    expect(session?.policy?.profile).toBe('deep');
    expect(session?.policy?.sources).toBe('docs');
  });
});
