// auto-log-vars-transformer.ts
import * as ts from 'typescript';

// Helper to get all identifiers in the current scope that are DECLARED BEFORE the targetNode
function getScopedVariablesDeclaredBeforeNode(
    targetNode: ts.Node,
    typeChecker: ts.TypeChecker,
    factory: ts.NodeFactory
): ts.Identifier[] {
    const identifiers: ts.Identifier[] = [];
    const targetPosition = targetNode.getStart(); // Position of the logger.log() call

    let current: ts.Node | undefined = targetNode;

    // Walk up the AST to find enclosing scopes
    while (current) {
        if (
            ts.isBlock(current) ||
            ts.isSourceFile(current) ||
            ts.isFunctionLike(current) || // Catches function parameters and body
            ts.isModuleBlock(current) ||
            ts.isCaseClause(current) || // For variables in switch cases
            ts.isDefaultClause(current)
        ) {
            // 1. Handle parameters for function-like declarations
            if (ts.isFunctionLike(current) && current.parameters) {
                current.parameters.forEach(param => {
                    if (ts.isIdentifier(param.name)) {
                        // Parameters are always considered "declared before" any statement in the function body
                        identifiers.push(param.name);
                    } else if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
                        // Handle destructuring in parameters
                        param.name.elements.forEach(element => {
                            if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                                identifiers.push(element.name);
                            }
                        });
                    }
                });
            }

            // 2. Handle declarations within the current block/scope
            current.forEachChild(childNode => {
                // Only consider declarations that appear before our target logger.log() call
                // if (childNode.getEnd() < targetPosition) {
                    if (ts.isVariableStatement(childNode)) {
                        childNode.declarationList.declarations.forEach(declaration => {
                            if (ts.isIdentifier(declaration.name)) {
                                identifiers.push(declaration.name);
                            } else if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
                                // Handle destructuring in variable declarations
                                declaration.name.elements.forEach(element => {
                                    if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                                        identifiers.push(element.name);
                                    }
                                });
                            }
                        });
                    // } else if (ts.isFunctionDeclaration(childNode) && childNode.name) {
                    //     // Function declarations are hoisted, but for consistency lets check position
                    //     identifiers.push(childNode.name);
                    } else if (ts.isClassDeclaration(childNode) && childNode.name) {
                        // Class declarations are not hoisted like var.
                        identifiers.push(childNode.name);
                    }
                    // Add other declaration types if needed (e.g., import declarations for imported bindings)
                // }
            });
        }
        current = current.parent;
    }

    // Filter out duplicates by text, preferring the one found in the "closest" scope (though this simple walk might not guarantee that perfectly without more complex scope tracking)
    // A more robust approach for duplicates/shadowing would involve checking symbols.
    const seen = new Set<string>();
    const uniqueIdentifiers = identifiers.filter(id => {
        if (seen.has(id.text)) {
            return false;
        }
        seen.add(id.text);
        return true;
    });

    console.log(`[TRANSFORMER DEBUG] For target node at ${targetPosition}:`);
    identifiers.forEach(id => console.log(`  - Found raw identifier: ${id.text} (pos: ${id.getStart()}-${id.getEnd()})`));
    uniqueIdentifiers.forEach(id => console.log(`  - Unique identifier: ${id.text}`));

    return uniqueIdentifiers;
}


export default function (program: ts.Program, pluginOptions: any): ts.TransformerFactory<ts.SourceFile> {
    const typeChecker = program.getTypeChecker();

    return (context: ts.TransformationContext) => {
        const factory = context.factory;

        const visitor = (node: ts.Node): ts.Node => {
            if (ts.isCallExpression(node)) {
                const expression = node.expression;
                let isLoggerCall = false;

                if (ts.isPropertyAccessExpression(expression) && expression.name.getText() === 'log') {
                    const symbol = typeChecker.getSymbolAtLocation(expression.expression);
                    // Ideally, you'd check if `symbol` truly resolves to your logger instance.
                    // For simplicity, if the object is named 'logger':
                    if (ts.isIdentifier(expression.expression) && expression.expression.getText() === 'dLogger') {
                        isLoggerCall = true;
                    }
                }
                // Add more robust checks for `isLoggerCall` if needed (e.g., imported logger)

                if (isLoggerCall) {
                    if (node.arguments.length >= 1) { // Expect at least the message argument
                        // Get variables declared *before* this specific logger.log() call
                        const scopedVars = getScopedVariablesDeclaredBeforeNode(node, typeChecker, factory);

                        const newArguments: ts.Expression[] = [node.arguments[0]]; // Start with the message

                        console.log(`[TRANSFORMER DEBUG] Logger call: ${node.getText()}`);
                        console.log(`  - Message: ${node.arguments[0].getText()}`);
                        console.log(`  - scopedVars (${scopedVars.length}):`, scopedVars.map(sv => sv.text));

                        if (scopedVars.length > 0) {
                            const objectLiteralProperties = scopedVars.map(idNode =>
                                factory.createShorthandPropertyAssignment(idNode) // Use the identifier node directly for shorthand
                            );
                            const localsObject = factory.createObjectLiteralExpression(objectLiteralProperties, true);
                            newArguments.push(localsObject);
                            console.log(`  - Injecting localsObject with keys: ${objectLiteralProperties.map(p => (p.name as ts.Identifier).text).join(', ')}`);
                        }
                        else{
                            console.log("  - No scoped vars to inject.");
                        }

                        if (node.arguments.length === 1 && scopedVars.length > 0) {
                             return factory.updateCallExpression(
                                node,
                                node.expression,
                                node.typeArguments,
                                newArguments // [message, newLocalsObject]
                            );
                        } else if (node.arguments.length === 1 && scopedVars.length === 0) {
                            // No variables to add, no change needed beyond what ts.visitEachChild does
                            return node;
                        }
                        // If node.arguments.length > 1, it means the user already passed a second argument.
                        // The current logic doesn't merge or overwrite. You might want to define that behavior.
                    }
                }
            }
            return ts.visitEachChild(node, visitor, context);
        };
        return (sourceFile: ts.SourceFile) => ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
}
