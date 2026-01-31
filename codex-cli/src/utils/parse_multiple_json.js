/**
 * Parses multiple concatenated JSON objects from a string
 * Perfectly handles: nested structures, strings with braces, escaped chars, streaming
 * @param {string} input - String containing concatenated JSON objects
 * @returns {{objects: any[], remainder: string, errors: string[], stats: object}}
 */
export function parseMultipleJSON(input, options = {}) {
    if (!input || typeof input !== 'string') {
        return { objects: [], remainder: '', errors: [], stats: {} };
    }

    const objects = [];
    const errors = [];
    let i = 0;
    const len = input.length;
    const maxObjects = options.maxObjects || 0;
    const strict = options.strict || false;

    while (i < len) {
        // Skip whitespace between objects
        while (i < len && /\s/.test(input[i])) i++;
        if (i >= len) break;

        if (maxObjects > 0 && objects.length >= maxObjects) {
            errors.push(`Reached limit of ${maxObjects} objects`);
            break;
        }

        // Find next JSON start if current position isn't valid
        if (input[i] !== '{' && input[i] !== '[') {
            const nextObj = input.indexOf('{', i);
            const nextArr = input.indexOf('[', i);
            const nextStart = (nextObj === -1) ? nextArr : 
                             (nextArr === -1) ? nextObj : Math.min(nextObj, nextArr);
            
            if (nextStart === -1) {
                const err = `Invalid character '${input[i]}' at position ${i}`;
                if (strict) return { objects, remainder: input.substring(i), errors: [...errors, err], stats: {} };
                errors.push(err);
                break;
            }
            errors.push(`Skipping invalid data from ${i} to ${nextStart}`);
            i = nextStart;
        }

        // Extract complete JSON using stack-based parsing
        let depth = 0;
        let inString = false;
        let escaped = false;
        const start = i;
        const openChar = input[i];
        const closeChar = openChar === '{' ? '}' : ']';

        while (i < len) {
            const char = input[i];

            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
            } else {
                if (char === '"') inString = true;
                else if (char === openChar) depth++;
                else if (char === closeChar) {
                    depth--;
                    if (depth === 0) {
                        // Found complete JSON - parse it
                        const jsonStr = input.substring(start, i + 1);
                        try {
                            objects.push(JSON.parse(jsonStr));
                        } catch (e) {
                            const err = `Parse error at ${start}: ${e.message}`;
                            if (strict) return { objects, remainder: input.substring(start), errors: [...errors, err], stats: {} };
                            errors.push(err);
                        }
                        i++;
                        break;
                    }
                }
            }
            i++;
        }

        // Handle incomplete JSON at end
        if (depth !== 0 && i >= len) {
            return {
                objects,
                remainder: input.substring(start),
                errors: [...errors, `Incomplete JSON at position ${start}`],
                stats: { parsed: objects.length, remaining: len - start }
            };
        }
    }

    return {
        objects,
        remainder: '',
        errors,
        stats: {
            parsed: objects.length,
            bytesProcessed: len - (input.substring(i).length),
            successRate: objects.length / (objects.length + errors.length) || 1
        }
    };
}
