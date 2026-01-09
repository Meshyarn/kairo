;; Python Exports
(assignment
  left: (identifier) @name
  right: (_)
  (#eq? @name "__all__")) @export
