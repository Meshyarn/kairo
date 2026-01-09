;; Go Call Graph
(call_expression
  function: [
    (identifier) @call.name
    (selector_expression field: (field_identifier) @call.name)
  ]) @call.node
