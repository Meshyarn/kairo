;; Basic Symbol Capture for TS
(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @method)
(class_declaration name: (type_identifier) @class)
(interface_declaration name: (type_identifier) @interface)
(type_alias_declaration name: (type_identifier) @type)
(enum_declaration name: (identifier) @type)
(variable_declarator name: (identifier) @variable)
