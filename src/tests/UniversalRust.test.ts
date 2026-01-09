import { AstManager } from '../ast/AstManager.js';

describe('Universal Language Parity - Rust Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract Rust symbols and imports correctly', async () => {
        const code = `
            use std::collections::HashMap;
            use std::io::{self, Read};
            
            pub fn run_server(port: u32) -> io::Result<()> {
                println!("Starting server on {}", port);
                Ok(())
            }
            
            struct User {
                id: u64,
                name: String,
            }
            
            impl User {
                fn new(name: &str) -> Self {
                    Self { id: 0, name: name.to_string() }
                }
            }
        `;
        const result = await astManager.extractUniversalTopology('main.rs', code);
        
        // Check imports
        const sources = result.imports.map((i: any) => i.source);
        expect(sources).toContain('std::collections::HashMap');
        expect(sources).toContain('std::io::{self, Read}');

        // Check symbols
        const symbolNames = result.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('run_server');
        expect(symbolNames).toContain('User');
    });

    it('should generate Rust skeleton with implementation hidden', async () => {
        const code = `
            fn complex_logic() {
                let x = 1;
                let y = 2;
                x + y
            }
            struct Data {
                field: i32
            }
            impl Data {
                fn get_field(&self) -> i32 {
                    self.field
                }
            }
        `;
        const skeleton = await astManager.generateUniversalSkeleton('lib.rs', code);
        
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).toContain('fn complex_logic()');
        expect(skeleton).toContain('impl Data');
        expect(skeleton).not.toContain('let x = 1');
    });
});
