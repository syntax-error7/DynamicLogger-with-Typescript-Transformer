// src/validators.ts
import { parse, Options as AcornOptions, Node as AcornNode } from 'acorn';
import { simple as walkSimple } from 'acorn-walk';

interface Violation {
    message: string;
    location: string; // e.g., "Line X"
}

interface ValidationResult {
    isValid: boolean;
    violations: Violation[];
}

// List of globally safe objects/namespaces allowed for direct calls or method calls
const safeGlobalObjectsAndNamespaces: string[] = [
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp',
    'Math', 'JSON', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Promise', 'Intl'
];

// Keywords and patterns that are disallowed
const disallowedKeywords: { keyword: string, message: string }[] = [
    { keyword: 'process', message: "Usage of 'process' object is disallowed." },
    { keyword: 'while', message: "Usage of 'while' loops is disallowed." },
    { keyword: 'for', message: "Usage of 'for' loops is disallowed." },
    { keyword: 'constructor', message: "Usage of 'constructor' keyword is disallowed." },
    { keyword: 'eval', message: "Usage of 'eval' is disallowed." },
    { keyword: 'Function', message: "Usage of 'Function' constructor is disallowed." }, // Disallow new Function()
    { keyword: 'require', message: "Usage of 'require' is disallowed." },
    { keyword: 'import', message: "Usage of dynamic 'import()' is disallowed." }, // Static imports are fine, this targets dynamic
    { keyword: 'window', message: "Usage of 'window' object is disallowed." },
    { keyword: 'document', message: "Usage of 'document' object is disallowed." },
    { keyword: 'global', message: "Usage of 'global' object is disallowed." }, // For Node.js global
    { keyword: 'globalThis', message: "Usage of 'globalThis' is disallowed." },
    { keyword: 'new', message: "Usage of 'new' to create objects is disallowed."},
    { keyword: 'fs', message: "Usage of 'fs' to access the file system is disallowed."},
    // To prevent any kind of asynchronous task scheduling from the custom code
    { keyword: 'async', message: "Usage of 'async' functions is disallowed." },
    { keyword: 'await', message: "Usage of 'await' is disallowed." },
    { keyword: 'setTimeout', message: "Usage of 'setTimeout' is disallowed." },
    { keyword: 'setInterval', message: "Usage of 'setInterval' is disallowed." },
];

function getLineNumberFromPosition(code: string, position: number): number {
    return code.substring(0, position).split('\n').length;
}

function isSafeCallee(node: AcornNode): boolean {
    const callee = (node as any).callee;

    // 1. Direct identifier call (e.g., String(), Object())
    if (callee.type === 'Identifier') {
        // Only allow if it's a known safe global constructor/function
        return safeGlobalObjectsAndNamespaces.includes(callee.name);
    }

    // 2. Member expression call (e.g., "hello".toUpperCase(), Math.max(), myArray.push())
    if (callee.type === 'MemberExpression') {
        let objectNode = callee.object;

        // Traverse to the base object of the member expression chain
        while (objectNode.type === 'MemberExpression') {
            objectNode = objectNode.object;
        }

        // If the base is an Identifier (e.g., Math.max, JSON.parse)
        if (objectNode.type === 'Identifier') {
            // Only allow if the base identifier is a known safe global object
            return safeGlobalObjectsAndNamespaces.includes(objectNode.name);
        }

        // If the base is a Literal (e.g., "string".toUpperCase(), [1,2].join())
        // or other expression types that are generally safe to call methods on
        // (like an ArrayExpression, ObjectExpression)
        if (
            objectNode.type === 'Literal' ||
            objectNode.type === 'ArrayExpression' ||
            objectNode.type === 'ObjectExpression' ||
            objectNode.type === 'TemplateLiteral'
        ) {
            return true;
        }
    }
    
    // Case 3: Allow immediate invocation of function expressions (IIFEs)
    // This means the `callee` itself is a function definition being called.
    if (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') {
        return true;
    }
    // Potentially allow calls on results of other safe calls, this part is tricky
    // For now, we are somewhat restrictive on chained calls if the base isn't clearly safe.
    return false; // Disallow other types of callees (e.g., direct function expressions as callees)
}


export function validateTSCode(code: string): ValidationResult {
    const violations: Violation[] = [];
    const lines = code.split('\n');

    // Check 1: Disallowed keywords
    for (let line_number = 0; line_number < lines.length; line_number++) {
        const line = lines[line_number];
        for (const forbidden of disallowedKeywords) {
            // Use regex to match whole words to avoid partial matches (e.g., 'processing' for 'process')
            const regex = new RegExp(`\\b${forbidden.keyword}\\b`);
            if (regex.test(line)) {
                violations.push({
                    message: forbidden.message,
                    location: `Line ${line_number + 1}`
                });
            }
        }
    }

    if (violations.length > 0) {
        return { isValid: false, violations };
    }

    // Check 2: AST-based validation for assignments and function calls
    try {
        const acornOptions: AcornOptions = {
            ecmaVersion: 2022,
            sourceType: 'script', // or 'module' if you expect ES module syntax
            locations: true,
        };
        const ast = parse(code, acornOptions);

        walkSimple(ast, {
            CallExpression(node: AcornNode) { 
                // Filtering function calls
                if (!isSafeCallee(node as AcornNode)) {
                    const location = (node as any).loc ? `Line ${getLineNumberFromPosition(code, (node as any).start)}` : 'Unknown location';
                    // Attempt to describe the call
                    let calleeDescription = 'unknown function';
                    const callee = (node as any).callee;
                    if (callee.type === 'Identifier') {
                        calleeDescription = callee.name;
                    } else if (callee.type === 'MemberExpression') {
                        try {
                            // Simple reconstruction, might not be perfect
                            let obj = callee.object.type === 'Identifier' ? callee.object.name : '[expr]';
                            let prop = callee.property.type === 'Identifier' ? callee.property.name : '[expr]';
                            calleeDescription = `${obj}.${prop}`;
                        } catch { /* ignore */ }
                    }
                    violations.push({
                        message: `Disallowed function call: ${calleeDescription}`,
                        location: location,
                    });
                }
            },
            // Filtering assignment expressions
            AssignmentExpression(node: AcornNode) {
                 violations.push({
                    message: "Direct assignment expressions are disallowed.",
                    location: (node as any).loc ? `Line ${getLineNumberFromPosition(code, (node as any).start)}` : 'Unknown location',
                });
            },
            // Add more disallowed node types as needed for stricter validation
        });

    } catch (error: any) {
        // This catch is for Acorn parsing errors (syntax errors in the provided code)
        violations.push({
            message: `Syntax error in custom code: ${error.message}`,
            location: error.loc ? `Line ${error.loc.line}` : 'Unknown location'
        });
        return { isValid: false, violations };
    }

    return {
        isValid: violations.length === 0,
        violations: violations,
    };
}