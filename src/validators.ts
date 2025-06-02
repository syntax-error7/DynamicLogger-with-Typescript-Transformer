// src/validators.ts
import { parse, Options as AcornOptions, Node as AcornNode } from 'acorn';
import { simple as walkSimple, FoundNode } from 'acorn-walk';

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
    'Promise', 'Intl',
    // Add any other truly safe global utility functions you might want to allow
    // e.g., 'decodeURIComponent', 'encodeURIComponent'
    // Be very careful with what you add here.
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
    // Keywords related to asynchronous operations that might be abused for long-running tasks
    // or creating hidden promises if not handled carefully by the overall system.
    // This is a stricter approach.
    // { keyword: 'async', message: "Usage of 'async' functions is disallowed." },
    // { keyword: 'await', message: "Usage of 'await' is disallowed." },
    // { keyword: 'setTimeout', message: "Usage of 'setTimeout' is disallowed." },
    // { keyword: 'setInterval', message: "Usage of 'setInterval' is disallowed." },
];

function getLineNumberFromPosition(code: string, position: number): number {
    return code.substring(0, position).split('\n').length;
}

function isSafeCallee(node: AcornNode, allAvailableLocals: Set<string>): boolean {
    const callee = (node as any).callee;

    // 1. Direct identifier call (e.g., myFunction(), String())
    if (callee.type === 'Identifier') {
        // Allow if it's a known safe global or a variable passed in `allAvailableLocals`
        return safeGlobalObjectsAndNamespaces.includes(callee.name) || allAvailableLocals.has(callee.name);
    }

    // 2. Member expression call (e.g., "hello".toUpperCase(), Math.max(), myArray.push())
    if (callee.type === 'MemberExpression') {
        let objectNode = callee.object;

        // Traverse to the base object of the member expression chain
        while (objectNode.type === 'MemberExpression') {
            objectNode = objectNode.object;
        }

        // If the base is an Identifier (e.g., Math.max, JSON.parse, myVar.method)
        if (objectNode.type === 'Identifier') {
            // Allow if the base identifier is a known safe global or a passed-in local
            return safeGlobalObjectsAndNamespaces.includes(objectNode.name) || allAvailableLocals.has(objectNode.name);
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
        // Potentially allow calls on results of other safe calls, this part is tricky
        // For now, we are somewhat restrictive on chained calls if the base isn't clearly safe.
    }
    return false; // Disallow other types of callees (e.g., direct function expressions as callees)
}


export function validateTSCode(code: string, availableLocals: string[] = []): ValidationResult {
    const violations: Violation[] = [];
    const lines = code.split('\n');

    // Check 1: Disallowed keywords
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const forbidden of disallowedKeywords) {
            // Use regex to match whole words to avoid partial matches (e.g., 'processing' for 'process')
            const regex = new RegExp(`\\b${forbidden.keyword}\\b`);
            if (regex.test(line)) {
                violations.push({
                    message: forbidden.message,
                    location: `Line ${i + 1}`
                });
            }
        }

        // Check 2: Single equals sign (basic assignment check)
        // This regex looks for a single '=' not preceded or followed by another common operator
        // that might make it part of '==', '===', '>=', '<=', '!='. It also avoids '=>'.
        // This is a heuristic and might have false positives/negatives.
        // A proper AST check for AssignmentExpression would be more robust here.
        const assignmentRegex = /(?<![=<>!])=(?![=>])/g;
        let match;
        while ((match = assignmentRegex.exec(line)) !== null) {
            // Further check to avoid matching inside strings, very basic
            const quotesBefore = (line.substring(0, match.index).match(/['"`]/g) || []).length;
            if (quotesBefore % 2 === 0) { // If not inside a string literal (very simplistic check)
                violations.push({
                    message: "Potential variable assignment or arrow function declaration detected. Assignments and complex function declarations are disallowed.",
                    location: `Line ${i + 1}`
                });
            }
        }
    }

    if (violations.length > 0) {
        return { isValid: false, violations };
    }

    // Check 3: Function calls using AST
    try {
        const acornOptions: AcornOptions = {
            ecmaVersion: 2022,
            sourceType: 'script', // or 'module' if you expect ES module syntax
            locations: true,
        };
        const ast = parse(code, acornOptions);
        const localsSet = new Set(availableLocals);

        walkSimple(ast, {
            CallExpression(node: FoundNode<AcornNode>) { // node is AcornNode here
                if (!isSafeCallee(node as AcornNode, localsSet)) {
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
            // Optionally, add checks for other disallowed AST node types:
            // ForStatement, WhileStatement, AssignmentExpression (more robust than regex)
            // NewExpression (if you want to disallow `new SomeClass()`)
            AssignmentExpression(node: FoundNode<AcornNode>) {
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