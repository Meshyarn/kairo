use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;

use crate::common::fs::SourceFile;
use crate::graph::imports;
use crate::graph::resolver;

/// Result of transitive impact analysis
#[derive(Debug)]
pub struct ImpactResult {
    pub file: String,
    /// Each element is a depth layer: layers[0] = direct dependents, layers[1] = depth 2, etc.
    pub layers: Vec<Vec<String>>,
    pub total: usize,
    pub direct: usize,
}

/// Dependency graph for a project
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ProjectGraph {
    /// file → set of files it imports (outgoing edges)
    pub edges: HashMap<String, HashSet<String>>,
    /// file → content_hash at time of last parse
    pub file_hashes: HashMap<String, u64>,
    /// Reverse edges (file → who imports it), computed from edges
    #[serde(skip)]
    reverse_edges: HashMap<String, HashSet<String>>,
}

impl ProjectGraph {
    /// Load an existing graph from `.kairo/graph.json`, or return empty
    pub fn load(root: &Path) -> Self {
        let path = root.join(".kairo").join("graph.json");
        match std::fs::read(&path) {
            Ok(bytes) => {
                let mut graph: Self = serde_json::from_slice(&bytes).unwrap_or_default();
                graph.rebuild_reverse();
                graph
            }
            Err(_) => Self::default(),
        }
    }

    /// Save graph to `.kairo/graph.json`
    pub fn save(&self, root: &Path) -> Result<()> {
        let dir = root.join(".kairo");
        std::fs::create_dir_all(&dir).context("create .kairo dir")?;
        let json = serde_json::to_string(self)?;
        std::fs::write(dir.join("graph.json"), json).context("write graph.json")?;
        Ok(())
    }

    /// Incrementally update the graph from a set of source files
    pub fn update(&mut self, files: &[SourceFile]) -> usize {
        let known_files: HashSet<String> = files.iter().map(|f| f.relative_path.clone()).collect();

        let mut changed = 0;

        // Remove deleted files
        let current_paths: HashSet<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        let deleted: Vec<String> = self
            .file_hashes
            .keys()
            .filter(|p| !current_paths.contains(p.as_str()))
            .cloned()
            .collect();
        for path in &deleted {
            self.edges.remove(path);
            self.file_hashes.remove(path);
            changed += 1;
        }

        // Process new/changed files
        for file in files {
            let old_hash = self.file_hashes.get(&file.relative_path);
            if old_hash == Some(&file.content_hash) {
                continue; // unchanged
            }

            let raw_imports = imports::extract_imports(&file.content, &file.extension);
            let mut resolved: HashSet<String> = HashSet::new();

            for imp in &raw_imports {
                if let Some(target) = resolver::resolve_import(
                    &imp.specifier,
                    &file.relative_path,
                    &file.extension,
                    &known_files,
                ) {
                    // Don't add self-edges
                    if target != file.relative_path {
                        resolved.insert(target);
                    }
                }
            }

            self.edges.insert(file.relative_path.clone(), resolved);
            self.file_hashes
                .insert(file.relative_path.clone(), file.content_hash);
            changed += 1;
        }

        if changed > 0 {
            self.rebuild_reverse();
        }

        changed
    }

    /// What does this file import? (outgoing edges)
    pub fn deps(&self, file: &str) -> Vec<String> {
        let mut deps: Vec<String> = self
            .edges
            .get(file)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        deps.sort();
        deps
    }

    /// Who imports this file? (incoming edges)
    pub fn dependents(&self, file: &str) -> Vec<String> {
        let mut deps: Vec<String> = self
            .reverse_edges
            .get(file)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();
        deps.sort();
        deps
    }

    /// Detect circular dependencies using DFS coloring
    pub fn cycles(&self) -> Vec<Vec<String>> {
        let mut cycles = Vec::new();
        let mut color: HashMap<&str, u8> = HashMap::new(); // 0=white, 1=gray, 2=black
        let mut path: Vec<&str> = Vec::new();

        for node in self.edges.keys() {
            if color.get(node.as_str()).copied().unwrap_or(0) == 0 {
                self.dfs_cycles(node, &mut color, &mut path, &mut cycles);
            }
        }

        // Deduplicate: normalize each cycle to start from its lexically smallest node
        let mut unique: Vec<Vec<String>> = Vec::new();
        for cycle in &cycles {
            let normalized = normalize_cycle(cycle);
            if !unique.contains(&normalized) {
                unique.push(normalized);
            }
        }

        unique
    }

    fn dfs_cycles<'a>(
        &'a self,
        node: &'a str,
        color: &mut HashMap<&'a str, u8>,
        path: &mut Vec<&'a str>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        color.insert(node, 1); // gray
        path.push(node);

        if let Some(neighbors) = self.edges.get(node) {
            for neighbor in neighbors {
                match color.get(neighbor.as_str()).copied().unwrap_or(0) {
                    0 => {
                        // white — recurse
                        self.dfs_cycles(neighbor, color, path, cycles);
                    }
                    1 => {
                        // gray — found a cycle: extract the cycle from path
                        if let Some(start) = path.iter().position(|&n| n == neighbor.as_str()) {
                            let cycle: Vec<String> =
                                path[start..].iter().map(|s| s.to_string()).collect();
                            if cycle.len() > 1 {
                                cycles.push(cycle);
                            }
                        }
                    }
                    _ => {} // black — already processed
                }
            }
        }

        path.pop();
        color.insert(node, 2); // black
    }

    /// Find shortest path between two files (BFS)
    pub fn path_between(&self, from: &str, to: &str) -> Option<Vec<String>> {
        if from == to {
            return Some(vec![from.to_string()]);
        }
        if !self.edges.contains_key(from) {
            return None;
        }

        let mut visited: HashSet<&str> = HashSet::new();
        let mut queue: VecDeque<Vec<&str>> = VecDeque::new();

        visited.insert(from);
        queue.push_back(vec![from]);

        while let Some(path) = queue.pop_front() {
            let current = *path.last().unwrap();

            if let Some(neighbors) = self.edges.get(current) {
                for neighbor in neighbors {
                    if neighbor == to {
                        let mut result: Vec<String> =
                            path.iter().map(|s| s.to_string()).collect();
                        result.push(to.to_string());
                        return Some(result);
                    }
                    if visited.insert(neighbor.as_str()) {
                        let mut new_path = path.clone();
                        new_path.push(neighbor.as_str());
                        queue.push_back(new_path);
                    }
                }
            }
        }

        None
    }

    /// Transitive impact analysis: BFS through reverse_edges to find all
    /// files affected by a change to the given file, grouped by depth.
    pub fn impact(&self, file: &str) -> ImpactResult {
        let mut layers: Vec<Vec<String>> = Vec::new();
        let mut visited: HashSet<&str> = HashSet::new();
        visited.insert(file);

        let mut frontier: Vec<&str> = vec![file];
        let max_depth = 10;

        for _ in 0..max_depth {
            let mut next_layer: Vec<String> = Vec::new();
            let mut next_frontier: Vec<&str> = Vec::new();

            for &node in &frontier {
                if let Some(rev) = self.reverse_edges.get(node) {
                    for dep in rev {
                        if visited.insert(dep.as_str()) {
                            next_layer.push(dep.clone());
                            next_frontier.push(dep.as_str());
                        }
                    }
                }
            }

            if next_layer.is_empty() {
                break;
            }
            next_layer.sort();
            layers.push(next_layer);
            frontier = next_frontier;
        }

        let direct = layers.first().map(|l| l.len()).unwrap_or(0);
        let total: usize = layers.iter().map(|l| l.len()).sum();

        ImpactResult {
            file: file.to_string(),
            layers,
            total,
            direct,
        }
    }

    /// Total number of edges in the graph
    pub fn edge_count(&self) -> usize {
        self.edges.values().map(|s| s.len()).sum()
    }

    /// Total number of nodes (files with at least one edge)
    pub fn node_count(&self) -> usize {
        let mut nodes: HashSet<&str> = HashSet::new();
        for (file, deps) in &self.edges {
            if !deps.is_empty() {
                nodes.insert(file);
            }
            for dep in deps {
                nodes.insert(dep);
            }
        }
        nodes.len()
    }

    fn rebuild_reverse(&mut self) {
        self.reverse_edges.clear();
        for (file, deps) in &self.edges {
            for dep in deps {
                self.reverse_edges
                    .entry(dep.clone())
                    .or_default()
                    .insert(file.clone());
            }
        }
    }
}

/// Normalize a cycle to start from its lexically smallest node
fn normalize_cycle(cycle: &[String]) -> Vec<String> {
    if cycle.is_empty() {
        return Vec::new();
    }
    let min_pos = cycle
        .iter()
        .enumerate()
        .min_by_key(|(_, s)| s.as_str())
        .map(|(i, _)| i)
        .unwrap_or(0);

    let mut normalized = Vec::with_capacity(cycle.len());
    for i in 0..cycle.len() {
        normalized.push(cycle[(min_pos + i) % cycle.len()].clone());
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_file(path: &str, content: &str, ext: &str) -> SourceFile {
        use crate::common::fs::hash_content;
        SourceFile {
            path: std::path::PathBuf::from(path),
            relative_path: path.to_string(),
            content: content.to_string(),
            extension: ext.to_string(),
            is_code: true,
            content_hash: hash_content(content),
        }
    }

    #[test]
    fn test_rust_graph() {
        let files = vec![
            make_file(
                "src/main.rs",
                "use crate::search::indexer;\nuse crate::common::fs;",
                "rs",
            ),
            make_file(
                "src/search/indexer.rs",
                "use crate::common::fs;\nuse anyhow::Result;",
                "rs",
            ),
            make_file("src/common/fs.rs", "use std::path::Path;", "rs"),
        ];

        let mut graph = ProjectGraph::default();
        graph.update(&files);

        assert_eq!(
            graph.deps("src/main.rs"),
            vec!["src/common/fs.rs", "src/search/indexer.rs"]
        );
        assert_eq!(
            graph.deps("src/search/indexer.rs"),
            vec!["src/common/fs.rs"]
        );
        assert!(graph.deps("src/common/fs.rs").is_empty());

        assert_eq!(
            graph.dependents("src/common/fs.rs"),
            vec!["src/main.rs", "src/search/indexer.rs"]
        );
    }

    #[test]
    fn test_cycle_detection() {
        let mut graph = ProjectGraph::default();
        let mut a_deps = HashSet::new();
        a_deps.insert("b.rs".to_string());
        let mut b_deps = HashSet::new();
        b_deps.insert("c.rs".to_string());
        let mut c_deps = HashSet::new();
        c_deps.insert("a.rs".to_string());

        graph.edges.insert("a.rs".to_string(), a_deps);
        graph.edges.insert("b.rs".to_string(), b_deps);
        graph.edges.insert("c.rs".to_string(), c_deps);
        graph.rebuild_reverse();

        let cycles = graph.cycles();
        assert_eq!(cycles.len(), 1);
        assert_eq!(cycles[0].len(), 3);
    }

    #[test]
    fn test_path_between() {
        let mut graph = ProjectGraph::default();
        let mut a = HashSet::new();
        a.insert("b.rs".to_string());
        let mut b = HashSet::new();
        b.insert("c.rs".to_string());

        graph.edges.insert("a.rs".to_string(), a);
        graph.edges.insert("b.rs".to_string(), b);
        graph.edges.insert("c.rs".to_string(), HashSet::new());

        let path = graph.path_between("a.rs", "c.rs");
        assert_eq!(
            path,
            Some(vec![
                "a.rs".to_string(),
                "b.rs".to_string(),
                "c.rs".to_string()
            ])
        );
        assert_eq!(graph.path_between("c.rs", "a.rs"), None);
    }

    #[test]
    fn test_impact_analysis() {
        // Graph: main → mcp → indexer → fs, main → fs, mcp → fs
        let files = vec![
            make_file(
                "src/main.rs",
                "use crate::mcp;\nuse crate::common::fs;",
                "rs",
            ),
            make_file(
                "src/mcp.rs",
                "use crate::search::indexer;\nuse crate::common::fs;",
                "rs",
            ),
            make_file("src/search/indexer.rs", "use crate::common::fs;", "rs"),
            make_file("src/common/fs.rs", "use std::path::Path;", "rs"),
        ];

        let mut graph = ProjectGraph::default();
        graph.update(&files);

        // Impact of changing fs.rs
        let result = graph.impact("src/common/fs.rs");
        assert_eq!(result.direct, 3); // main, mcp, indexer all import fs directly
        assert_eq!(result.total, 3); // no further propagation needed
        assert_eq!(result.layers.len(), 1); // all at depth 1

        // Impact of changing indexer.rs
        let result = graph.impact("src/search/indexer.rs");
        assert_eq!(result.direct, 1); // only mcp imports indexer
        assert!(result.layers[0].contains(&"src/mcp.rs".to_string()));
        // depth 2: main imports mcp
        assert_eq!(result.total, 2); // mcp + main
        assert_eq!(result.layers.len(), 2);

        // Impact of changing main.rs — nothing imports main
        let result = graph.impact("src/main.rs");
        assert_eq!(result.total, 0);
        assert!(result.layers.is_empty());
    }
}
