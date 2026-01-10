;; C Symbols
(function_definition
  declarator: (function_declarator declarator: (identifier) @function))
(function_definition declarator: (identifier) @function)
(struct_specifier name: (type_identifier) @type)
(struct_specifier name: (identifier) @type)
(enum_specifier name: (identifier) @type)
