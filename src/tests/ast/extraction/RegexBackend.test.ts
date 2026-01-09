import { RegexBackend } from '../../../ast/extraction/backends/RegexBackend.js';

describe('RegexBackend', () => {
    const backend = new RegexBackend();

    test('maps imports and exports into info objects', async () => {
        const content = `
import React, { useState as useStateAlias } from 'react';
import * as Utils from './utils';
import './side-effect';
export const answer = 42;
export { foo } from './foo';
export default function App() {}
`;

        const imports = await backend.extractImports({
            filePath: 'sample.ts',
            content,
            languageId: 'typescript'
        });
        const exports = await backend.extractExports({
            filePath: 'sample.ts',
            content,
            languageId: 'typescript'
        });

        const reactImport = imports.find(entry => entry.specifier === 'react');
        expect(reactImport?.importType).toBe('named');
        expect(reactImport?.what).toEqual(expect.arrayContaining(['useStateAlias']));

        const namespaceImport = imports.find(entry => entry.importType === 'namespace');
        expect(namespaceImport?.what).toEqual(['*']);

        const sideEffectImport = imports.find(entry => entry.importType === 'side-effect');
        expect(sideEffectImport?.specifier).toBe('./side-effect');

        expect(exports.some(entry => entry.exportType === 'default')).toBe(true);
        const reExport = exports.find(entry => entry.isReExport);
        expect(reExport?.reExportFrom).toBeUndefined();
    });
});
