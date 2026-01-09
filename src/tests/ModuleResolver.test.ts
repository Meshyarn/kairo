import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModuleResolver } from '../ast/ModuleResolver.js';

describe('ModuleResolver', () => {
    const testDir = path.join(process.cwd(), 'src', 'tests', 'module_resolver_test_env');
    let resolver: ModuleResolver;

    beforeAll(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        fs.mkdirSync(testDir, { recursive: true });

        // Create file structure
        // /foo.ts
        fs.writeFileSync(path.join(testDir, 'foo.ts'), '');
        // /bar.js
        fs.writeFileSync(path.join(testDir, 'bar.js'), '');
        // /utils/index.ts
        fs.mkdirSync(path.join(testDir, 'utils'));
        fs.writeFileSync(path.join(testDir, 'utils', 'index.ts'), '');
        // /component.tsx
        fs.writeFileSync(path.join(testDir, 'component.tsx'), '');
        // Dot-segment filenames without explicit extensions
        fs.writeFileSync(path.join(testDir, 'pygg.validation.js'), '');
        fs.writeFileSync(path.join(testDir, 'campaigns.model.ts'), '');
        
        // Priority test: baz.ts and baz.js
        fs.writeFileSync(path.join(testDir, 'baz.ts'), '');
        fs.writeFileSync(path.join(testDir, 'baz.js'), '');

        // Bundler fallback target
        fs.mkdirSync(path.join(testDir, 'shared'));
        fs.writeFileSync(path.join(testDir, 'shared', 'Button.ts'), '');

        // Monorepo-style tsconfig
        const widgetDir = path.join(testDir, 'packages', 'widgets');
        fs.mkdirSync(widgetDir, { recursive: true });
        fs.writeFileSync(path.join(widgetDir, 'widget.ts'), '');
        fs.writeFileSync(path.join(widgetDir, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                baseUrl: '.',
                paths: {
                    '@widgets/*': ['*']
                }
            }
        }, null, 2));

        fs.writeFileSync(path.join(testDir, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                baseUrl: '.',
                paths: {
                    '@utils/*': ['utils/*'],
                    '@component': ['component.tsx']
                }
            }
        }, null, 2));
    });

    afterAll(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

        beforeEach(() => {
        resolver = new ModuleResolver(testDir);
    });

    it('should resolve relative path with extension', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './foo.ts');
        expect(resolved).toBe(path.join(testDir, 'foo.ts'));
    });

    it('should resolve relative path without extension', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './foo');
        expect(resolved).toBe(path.join(testDir, 'foo.ts'));
    });

    it('should resolve directory index', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './utils');
        expect(resolved).toBe(path.join(testDir, 'utils', 'index.ts'));
    });

    it('should resolve dot-segment specifiers without explicit extensions', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './pygg.validation');
        expect(resolved).toBe(path.join(testDir, 'pygg.validation.js'));
    });

    it('should resolve dot-segment specifiers to ts files', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './campaigns.model');
        expect(resolved).toBe(path.join(testDir, 'campaigns.model.ts'));
    });

    it('should prioritize .ts over .js', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './baz');
        expect(resolved).toBe(path.join(testDir, 'baz.ts'));
    });

    it('should return null for missing files', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, './missing');
        expect(resolved).toBeNull();
    });
    
    it('should handle absolute paths', () => {
        const absPath = path.join(testDir, 'foo.ts');
        const resolved = resolver.resolve('/any/context', absPath); // Context ignored for abs path
        expect(resolved).toBe(absPath);
    });

    it('should resolve tsconfig wildcard alias', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, '@utils/index');
        expect(resolved).toBe(path.join(testDir, 'utils', 'index.ts'));
    });

    it('should resolve tsconfig direct alias', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, '@component');
        expect(resolved).toBe(path.join(testDir, 'component.tsx'));
    });

    it('should discover nested tsconfig aliases automatically', () => {
        const context = path.join(testDir, 'main.ts');
        const resolved = resolver.resolve(context, '@widgets/widget');
        expect(resolved).toBe(path.join(testDir, 'packages', 'widgets', 'widget.ts'));
    });

    it('should use bundler-style fallback when configured', () => {
        const bundlerResolver = new ModuleResolver({ rootPath: testDir, fallbackResolution: 'bundler' });
        const context = path.join(testDir, 'main.ts');
        const resolved = bundlerResolver.resolve(context, 'shared/Button');
        expect(resolved).toBe(path.join(testDir, 'shared', 'Button.ts'));
    });

    it('returns metadata for core module specifiers', () => {
        const context = path.join(testDir, 'main.ts');
        const result = resolver.resolveDetailed(context, 'fs');
        expect(result.resolvedPath).toBeNull();
        expect(result.strategy).toBe('node');
        expect(result.metadata?.core).toBe('true');
    });

    it('marks unresolved bare specifiers as external', () => {
        const context = path.join(testDir, 'main.ts');
        const result = resolver.resolveDetailed(context, 'nonexistent-module-xyz');
        expect(result.resolvedPath).toBeNull();
        expect(result.metadata?.external).toBe('true');
        expect(result.metadata?.reason).toContain('Unresolved');
    });

    it('caches resolution results and clears cache on reload', () => {
        const context = path.join(testDir, 'main.ts');
        const first = resolver.resolveDetailed(context, './foo');
        const second = resolver.resolveDetailed(context, './foo');
        expect(second).toBe(first);

        resolver.clearCache();
        const third = resolver.resolveDetailed(context, './foo');
        expect(third).not.toBe(second);

        resolver.reloadConfig();
        const fourth = resolver.resolveDetailed(context, './foo');
        expect(fourth).not.toBe(third);
    });

    it('records bundler fallback attempts in detailed resolution', () => {
        const bundlerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'module-resolver-bundler-'));
        fs.mkdirSync(path.join(bundlerRoot, 'shared'), { recursive: true });
        fs.writeFileSync(path.join(bundlerRoot, 'shared', 'Button.ts'), '');
        const bundlerResolver = new ModuleResolver({ rootPath: bundlerRoot, fallbackResolution: 'bundler' });
        const context = path.join(bundlerRoot, 'main.ts');
        const result = bundlerResolver.resolveDetailed(context, 'shared/Button');
        expect(result.strategy).toBe('bundler');
        expect(result.attempts.some(attempt => attempt.strategy === 'bundler')).toBe(true);
        fs.rmSync(bundlerRoot, { recursive: true, force: true });
    });
});
