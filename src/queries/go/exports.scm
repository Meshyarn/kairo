;; Go Exports - Capitalized identifiers are exported
(function_declaration name: (identifier) @name (#match? @name "^[A-Z]")) @export
(method_declaration name: (field_identifier) @name (#match? @name "^[A-Z]")) @export
(type_declaration (type_spec name: (type_identifier) @name (#match? @name "^[A-Z]"))) @export
(const_declaration (const_spec name: (identifier) @name (#match? @name "^[A-Z]"))) @export
(var_declaration (var_spec name: (identifier) @name (#match? @name "^[A-Z]"))) @export
