const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

console.warn = (...args: any[]) => {
  if (args.length === 1 && typeof args[0] === "string") {
    try {
      const parsed = JSON.parse(args[0]);
      if (parsed?.code === "TOOL_DEPRECATED") {
        return;
      }
    } catch {
      // fall through
    }
  }
  if (args.length >= 1 && typeof args[0] === "string") {
    if (args[0].startsWith("[LanguageConfig] Failed to parse ")) {
      return;
    }
    if (args[0].startsWith("[Embedding] Primary model failed; falling back")) {
      return;
    }
  }
  originalWarn(...args);
};

console.error = (...args: any[]) => {
  if (args.length >= 1 && typeof args[0] === "string") {
    const message = args[0];
    if (message.startsWith("An error occurred during model execution")) {
      return;
    }
    if (message.startsWith("Inputs given to model")) {
      return;
    }
  }
  originalError(...args);
};
