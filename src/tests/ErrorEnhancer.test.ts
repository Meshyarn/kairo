import { ErrorEnhancer } from '../errors/ErrorEnhancer.js';
import { SymbolIndex } from '../ast/SymbolIndex.js';
import { jest } from '@jest/globals';

describe('ErrorEnhancer', () => {
    const mockSymbolIndex = {
        findSimilar: jest.fn<any>().mockReturnValue([{ name: 'UserService' }]),
        getSymbolsForFile: jest.fn<any>(),
        getAllSymbols: jest.fn<any>(),
        findFilesBySymbolName: jest.fn<any>()
    } as unknown as SymbolIndex;

    it('should enhance symbol not found error', () => {
        const details = ErrorEnhancer.enhanceSymbolNotFound('UserSvc', mockSymbolIndex);
        expect(details.similarSymbols).toContain('UserService');
        expect(details.toolSuggestions?.some(s => s.toolName === 'project_search')).toBe(true);
    });

    it('should enhance search not found error for filenames', () => {
        const details = ErrorEnhancer.enhanceSearchNotFound('config.json');
        expect(details.toolSuggestions?.some(s => s.exampleArgs?.type === 'filename')).toBe(true);
    });

    it('should enhance NO_MATCH errors', () => {
        const details = ErrorEnhancer.enhanceNoMatch('src/test.ts');
        expect(details.toolSuggestions?.some(s => s.toolName === 'code_read')).toBe(true);
        expect(details.nextActionHint).toContain('code_read(fragment)');
    });

    it('should enhance HASH_MISMATCH errors', () => {
        const details = ErrorEnhancer.enhanceHashMismatch('src/test.ts');
        expect(details.toolSuggestions?.some(s => s.toolName === 'code_read')).toBe(true);
        expect(details.nextActionHint).toContain('Refresh its metadata');
    });

    it('should enhance INDEX_STALE errors', () => {
        const details = ErrorEnhancer.enhanceIndexStale();
        expect(details.toolSuggestions?.some(s => s.toolName === 'project_manage')).toBe(true);
        expect(details.nextActionHint).toContain('index status');
    });
});
