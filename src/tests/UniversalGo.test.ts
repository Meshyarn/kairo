import { AstManager } from '../ast/AstManager.js';

describe('Universal Language Parity - Go Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract Go symbols and nested imports correctly', async () => {
        const code = `
            package main
            import "fmt"
            import (
                "os"
                "net/http"
            )
            func Greet(name string) {
                fmt.Printf("Hello, %s", name)
            }
            type Config struct {
                Port int
            }
        `;
        const result = await astManager.extractUniversalTopology('server.go', code);
        
        // Check imports
        const sources = result.imports.map((i: any) => i.source);
        expect(sources).toContain('fmt');
        expect(sources).toContain('os');
        expect(sources).toContain('net/http');

        // Check top-level symbols
        const symbolNames = result.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('Greet');
        expect(symbolNames).toContain('Config');
    });

    it('should generate Go skeleton with implementation hidden', async () => {
        const code = `
            func HandleRequest(w http.ResponseWriter, r *http.Request) {
                log.Println("Request received")
                w.Write([]byte("OK"))
            }
            type Database interface {
                Query(q string) error
            }
        `;
        const skeleton = await astManager.generateUniversalSkeleton('api.go', code);
        
        // Check if implementation is hidden by checking for the fold marker
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).toContain('func HandleRequest');
        expect(skeleton).toContain('type Database interface');
        
        // Ensure implementation details are gone
        expect(skeleton).not.toContain('log.Println');
        expect(skeleton).not.toContain('w.Write');
    });
});
