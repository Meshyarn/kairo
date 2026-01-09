;; PHP Imports
(namespace_use_declaration
  (namespace_use_clause
    (qualified_name) @source)) @import

(require_expression (string) @source) @import
(include_expression (string) @source) @import
(require_once_expression (string) @source) @import
(include_once_expression (string) @source) @import
