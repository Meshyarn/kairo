;; C++ Symbols
(function_definition
  declarator: (function_declarator declarator: (identifier) @function))
(function_definition declarator: (identifier) @function)
(class_specifier name: (type_identifier) @class)
(struct_specifier name: (type_identifier) @type)
(enum_specifier name: (identifier) @type)
(namespace_definition name: (identifier) @namespace)
