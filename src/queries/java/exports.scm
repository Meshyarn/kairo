;; Java Exports - public classes/interfaces/enums
(class_declaration 
  (modifiers) @export.vis 
  name: (identifier) @name
  (#match? @export.vis "public")) @export

(interface_declaration 
  (modifiers) @export.vis 
  name: (identifier) @name
  (#match? @export.vis "public")) @export

(enum_declaration 
  (modifiers) @export.vis 
  name: (identifier) @name
  (#match? @export.vis "public")) @export
