
import { AstManager } from '../ast/AstManager.js';

describe('Universal Language Parity - PHP Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    });

    it('should extract PHP symbols and imports correctly', async () => {
        const code = `<?php
            namespace App\\Services;

            use Illuminate\\Http\\Request;
            use App\\Models\\User;

            interface Processor {
                public function execute();
            }

            class PaymentProcessor implements Processor {
                public function execute() {
                    // processing
                }

                public function validate(Request $request) {
                    return true;
                }
            }

            function helper() {
                return 'helper';
            }
        `;
        const result = await astManager.extractUniversalTopology('Processor.php', code);
        
        // Check imports
        const sources = result.imports.map((i: any) => i.source);
        expect(sources).toContain('Illuminate\\Http\\Request');
        expect(sources).toContain('App\\Models\\User');

        // Check symbols
        const symbolNames = result.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('Processor');
        expect(symbolNames).toContain('PaymentProcessor');
        expect(symbolNames).toContain('helper');
        
        // Check nested symbols (methods) - captured by symbols.scm
        expect(symbolNames).toContain('execute'); 
        expect(symbolNames).toContain('validate');
    });

    it('should generate PHP skeleton with implementation hidden', async () => {
        const code = `<?php
            class Calculator {
                public function add($a, $b) {
                    // complex logic
                    return $a + $b;
                }
            }
        `;
        const skeleton = await astManager.generateUniversalSkeleton('Calculator.php', code);
        
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).toContain('class Calculator');
        expect(skeleton).toContain('public function add($a, $b)');
        expect(skeleton).not.toContain('return $a + $b');
    });
});
