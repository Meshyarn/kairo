;; Rust Call Graph
(call_expression
  function: [
    (identifier) @call.name
    (field_expression field: (field_identifier) @call.name)
    (scoped_identifier name: (identifier) @call.name)
  ]) @call.node
