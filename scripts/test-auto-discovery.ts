
import { EngineManager } from '../src/orchestration/capabilities/EngineManager.js';
import { CAP_CHUNKING_TOKENS } from '../src/orchestration/capabilities/CapabilityIds.js';

async function testAutoDiscovery() {
    console.log("🧪 ADR-053-H Auto-Discovery Final Verification");
    console.log("----------------------------------------------");

    // EngineManager will automatically initialize and try to find native providers
    const engine = EngineManager.getProvider<any>(CAP_CHUNKING_TOKENS);
    const diagnostics = EngineManager.getDiagnostics();
    const provider = diagnostics.capabilities[CAP_CHUNKING_TOKENS]?.provider;
    
    console.log(`▶️  Active Provider: [${provider?.tier}] (ID: ${provider?.id})`);

    if (provider?.tier === 'native') {
        const text = "Checking if Rust engine can now find its tokenizer automatically.";
        const result = await engine.chunk(text, 10, 0);
        console.log(`   ✅ Success! Rust engine is active and chunking. Count: ${result.length}`);
    } else {
        console.log("   ❌ Still falling back to JS. Something is missing.");
        console.log("   Full Diagnostics for Chunking:");
        console.log(JSON.stringify(diagnostics.capabilities[CAP_CHUNKING_TOKENS], null, 2));
        
        console.log("\n   Checking if tokenizer.json exists in common paths...");
        // Add more debugging if needed
    }
}

testAutoDiscovery().catch(console.error);
