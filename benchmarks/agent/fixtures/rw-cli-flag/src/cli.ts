export type Options = {
  input: string;
  output: string;
};

export function parseArgs(argv: string[]) {
  const options: Options = { input: "", output: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      options.input = argv[i + 1];
      i += 1;
    } else if (arg === "--output") {
      options.output = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

export function usage() {
  return [
    "Usage: tool --input <path> --output <path>",
    "",
    "Options:",
    "  --input   Input file path.",
    "  --output  Output file path."
  ].join("\n");
}
