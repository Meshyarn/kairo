
import { jest } from '@jest/globals';
import { AstManager } from '../ast/AstManager.js';

jest.setTimeout(20000);

describe('Universal Language Parity - Java Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract Java symbols and imports correctly', async () => {
        const code = `
            package com.example.app;

            import java.util.List;
            import java.util.ArrayList;
            import static java.lang.Math.PI;

            public class UserManager {
                private List<String> users;

                public UserManager() {
                    this.users = new ArrayList<>();
                }

                public void addUser(String name) {
                    this.users.add(name);
                }
            }

            public interface IService {
                void execute();
            }

            public enum Status {
                ACTIVE, INACTIVE
            }
        `;
        const result = await astManager.extractUniversalTopology('UserManager.java', code);
        
        // Check imports
        const sources = result.imports.map((i: any) => i.source);
        expect(sources).toContain('java.util.List');
        expect(sources).toContain('java.util.ArrayList');
        expect(sources).toContain('java.lang.Math.PI');

        // Check symbols (classes, interfaces, enums, public methods)
        const symbolNames = result.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('UserManager');
        expect(symbolNames).toContain('addUser'); // Public method
        expect(symbolNames).toContain('IService');
        expect(symbolNames).toContain('Status');
    });

    it('should generate Java skeleton with implementation hidden', async () => {
        const code = `
            public class Calculator {
                public int add(int a, int b) {
                    // complex logic
                    return a + b;
                }
            }
        `;
        const skeleton = await astManager.generateUniversalSkeleton('Calculator.java', code);
        
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).toContain('public class Calculator');
        expect(skeleton).toContain('public int add(int a, int b)');
        expect(skeleton).not.toContain('return a + b');
    });
});
