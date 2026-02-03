import type { StoredGhostSymbol } from "./IndexTypes.js";

type GhostStoreState = {
    ghosts: Map<string, StoredGhostSymbol>;
};

export const addGhost = (store: GhostStoreState, ghost: StoredGhostSymbol): void => {
    store.ghosts.set(ghost.name, { ...ghost });
};

export const findGhost = (store: GhostStoreState, name: string): StoredGhostSymbol | undefined => {
    const ghost = store.ghosts.get(name);
    return ghost ? { ...ghost } : undefined;
};

export const listGhosts = (store: GhostStoreState): StoredGhostSymbol[] => {
    return Array.from(store.ghosts.values()).map(ghost => ({ ...ghost }));
};

export const deleteGhost = (store: GhostStoreState, name: string): void => {
    store.ghosts.delete(name);
};

export const pruneGhosts = (store: GhostStoreState, olderThanMs: number): void => {
    const cutoff = Date.now() - olderThanMs;
    for (const [name, ghost] of store.ghosts.entries()) {
        if (ghost.deletedAt < cutoff) {
            store.ghosts.delete(name);
        }
    }
};
