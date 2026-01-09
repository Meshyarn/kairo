;; Python Call Graph
(call
  function: [
    (identifier) @call.name
    (attribute attribute: (identifier) @call.name)
  ]) @call.node
