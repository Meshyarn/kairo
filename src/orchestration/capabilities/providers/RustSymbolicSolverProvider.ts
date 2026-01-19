import { NativeModuleLoader } from "../NativeModuleLoader.js";
import type { CapabilityProvider } from "../EngineManager.js";
import type { ISymbolicSolverProvider, SymbolicSolverInput, SymbolicSolverResult } from "../SymbolicSolver.js";

type RustSymbolicSolve = (input: SymbolicSolverInput) => SymbolicSolverResult | Promise<SymbolicSolverResult>;

export class RustSymbolicSolverProvider implements CapabilityProvider<ISymbolicSolverProvider> {
    meta = { id: "RustSymbolicSolverProvider", tier: "native" as const, priority: 100 };
    private provider: ISymbolicSolverProvider | null = null;

    constructor() {
        const core = NativeModuleLoader.getShared().getRustCore() as { symbolicSolve?: RustSymbolicSolve } | null;
        if (!core || typeof core.symbolicSolve !== "function") {
            return;
        }
        const solver = core.symbolicSolve.bind(core);
        this.provider = {
            solve: async (input: SymbolicSolverInput) => await solver(input)
        };
    }

    isAvailable(): boolean {
        return this.provider !== null;
    }

    get(): ISymbolicSolverProvider {
        return this.provider as ISymbolicSolverProvider;
    }

    diagnose() {
        if (this.provider) {
            return { available: true };
        }
        const loadError = NativeModuleLoader.getShared().getLoadError();
        if (loadError) {
            return { available: false, reason: `rust_core_unavailable: ${loadError.message}` };
        }
        return { available: false, reason: "rust_symbolic_solver_unavailable" };
    }
}
