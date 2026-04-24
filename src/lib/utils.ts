import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parses a value if it's a JSON string, otherwise returns the value as-is
 * @param value - The value to parse
 * @returns Parsed value or original value
 */
export function parseJsonString(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      // Check if it looks like a JSON string (starts with [ or {)
      const trimmed = value.trim();
      if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || 
          (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        return JSON.parse(value);
      }
    } catch (e) {
      // If parsing fails, return original string
      return value;
    }
  }
  return value;
}

/**
 * Recursively parses all JSON string fields in an object
 * @param obj - The object to parse
 * @param fieldsToParse - Optional array of field names to specifically parse (if not provided, parses all string fields that look like JSON)
 * @returns Object with parsed values
 */
export function parseJsonStringFields<T extends Record<string, unknown>>(
  obj: T,
  fieldsToParse?: string[]
): T {
  const parsed = { ...obj } as Record<string, unknown>;
  // console.log("parsed", parsed);
  // console.log("fieldsToParse", fieldsToParse);
  Object.keys(parsed).forEach((key) => {
    // console.log("key", key);
    const value = parsed[key];
    // If fieldsToParse is provided, only parse those fields
    // Otherwise, try to parse any string that looks like JSON
    if (fieldsToParse ? fieldsToParse.includes(key) : true) {
      const parsedValue = parseJsonString(value);
      
      // Recursively parse nested objects and arrays
      if (Array.isArray(parsedValue)) {
        parsed[key] = parsedValue.map((item) => {
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            return parseJsonStringFields(item as Record<string, unknown>, fieldsToParse);
          }
          return parseJsonString(item);
        });
      } else if (typeof parsedValue === 'object' && parsedValue !== null && !Array.isArray(parsedValue)) {
        parsed[key] = parseJsonStringFields(parsedValue as Record<string, unknown>, fieldsToParse);
      } else {
        parsed[key] = parsedValue;
      }
    }
  });
  
  return parsed as T;
}