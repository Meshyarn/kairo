;; TypeScript Call Graph Extraction
(call_expression
  function: [
    (identifier) @call.name
    (member_expression property: (property_identifier) @call.name)
  ]) @call.node
