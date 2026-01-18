;; TypeScript symbolic guard capture set

;; Guard conditions
(if_statement condition: (parenthesized_expression) @guard.condition)
(while_statement condition: (parenthesized_expression) @guard.condition)
(do_statement condition: (parenthesized_expression) @guard.condition)
(for_statement
  (expression_statement
    (expression) @guard.condition))
(ternary_expression) @guard.condition

;; Index access
(subscript_expression) @guard.index_access

;; Member access (deref)
(member_expression) @guard.deref

;; Length/size hints
(member_expression
  property: (property_identifier) @guard.len
  (#eq? @guard.len "length")) @guard.len

;; Binary expressions (used for division + null check heuristics)
(binary_expression) @guard.binary

;; Null check candidates (filtered in engine)
(binary_expression) @guard.null_check
