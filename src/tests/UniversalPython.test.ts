import { AstManager } from '../ast/AstManager.js';

describe('Universal Language Parity - Python Support', () => {
    let astManager: AstManager;

    beforeAll(async () => {
        astManager = AstManager.getInstance();
        await astManager.init();
    }, 60000);

    it('should extract Python symbols and imports correctly', async () => {
        const code = `
import os
from math import sqrt, pi
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from . import utils
from ..core import config

def calculate_area(radius):
    return pi * sqrt(radius)

class ShapeService:
    def __init__(self):
        self.executor = ThreadPoolExecutor()
        
    async def process(self, data):
        pass
        `;
        const result = await astManager.extractUniversalTopology('service.py', code);
        
        // Check imports (should contain the module names)
        const sources = result.imports.map((i: any) => i.source);
        expect(sources).toContain('os');
        expect(sources).toContain('math');
        expect(sources).toContain('concurrent.futures');
        expect(sources).toContain('numpy');
        expect(sources).toContain('.');
        expect(sources).toContain('..core');

        // Check symbols
        const symbolNames = result.topLevelSymbols.map((s: any) => s.name);
        expect(symbolNames).toContain('calculate_area');
        expect(symbolNames).toContain('ShapeService');
    });

    it('should generate Python skeleton with implementation hidden', async () => {
        const code = `
def long_function():
    x = 1
    y = 2
    return x + y

class LargeClass:
    def method_one(self):
        print("doing something")
        `;
        const skeleton = await astManager.generateUniversalSkeleton('app.py', code);
        
        // Universal engine defaults to { ... } for folded blocks regardless of language
        expect(skeleton).toContain('{ ... }');
        expect(skeleton).toContain('def long_function()');
        expect(skeleton).toContain('class LargeClass');
        expect(skeleton).not.toContain('print(');
    });
});
