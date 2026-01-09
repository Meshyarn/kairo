;; Python Imports
(import_statement (dotted_name) @source) @import
(import_statement (aliased_import name: (dotted_name) @source)) @import
(import_from_statement module_name: (dotted_name) @source) @import
(import_from_statement module_name: (relative_import) @source) @import
