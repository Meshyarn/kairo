export function jsonResponse(payload: any): any {
  return {
    isError: false,
    content: [{ type: "text", text: JSON.stringify(payload, jsonReplacer, 2) }]
  };
}

export function textResponse(text: string): any {
  return {
    isError: false,
    content: [{ type: "text", text }]
  };
}

export function errorResponse(errorCode: string, message: string, details?: any): any {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ errorCode, message, details }) }]
  };
}

function jsonReplacer(_key: string, value: any): any {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  if (value instanceof Set) {
    return Array.from(value.values());
  }
  return value;
}
