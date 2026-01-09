;; Rust Skeleton Folding

;; Fold function bodies
(function_item body: (block) @skeleton.fold)

;; Fold struct and enum bodies
(struct_item body: (field_declaration_list) @skeleton.fold)
(enum_item body: (enum_variant_list) @skeleton.fold)

;; Fold trait and impl blocks
(trait_item body: (declaration_list) @skeleton.fold)
(impl_item body: (declaration_list) @skeleton.fold)

;; Fold mod blocks
(mod_item body: (declaration_list) @skeleton.fold)
