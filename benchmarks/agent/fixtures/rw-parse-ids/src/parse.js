export function parseIds(input) {
  return input.split(",").map((value) => parseInt(value));
}
