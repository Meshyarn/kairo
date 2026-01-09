;; Go Skeleton Folding

;; Fold function and method bodies
(function_declaration body: (block) @skeleton.fold)
(method_declaration body: (block) @skeleton.fold)

;; Fold struct definitions
(struct_type (field_declaration_list) @skeleton.fold)

;; Fold interface definitions using a very safe wildcard
;; This captures the block that follows 'interface'
(interface_type (_) @skeleton.fold (#match? @skeleton.fold "^\\{"))
