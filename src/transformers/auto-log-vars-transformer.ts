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
                if (childNode.getEnd() < targetPosition) {
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
                    } else if (ts.isFunctionDeclaration(childNode) && childNode.name) {
                        // Function declarations are hoisted, but for consistency,
                        // we can still check position or just include them.
                        // Let's be strict for now and check position.
                        identifiers.push(childNode.name);
                    } else if (ts.isClassDeclaration(childNode) && childNode.name) {
                        // Class declarations are not hoisted like var.
                        identifiers.push(childNode.name);
                    }
                    // Add other declaration types if needed (e.g., import declarations for imported bindings)
                }
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
                    if (ts.isIdentifier(expression.expression) && expression.expression.getText() === 'logger') {
                        isLoggerCall = true;
                    }
                }
                // Add more robust checks for `isLoggerCall` if needed (e.g., imported logger)

                if (isLoggerCall) {
                    if (node.arguments.length >= 1) { // Expect at least the message argument
                        // Get variables declared *before* this specific logger.log() call
                        const scopedVars = getScopedVariablesDeclaredBeforeNode(node, typeChecker, factory);

                        const newArguments: ts.Expression[] = [node.arguments[0]]; // Start with the message

                        if (scopedVars.length > 0) {
                            const objectLiteralProperties = scopedVars.map(idNode =>
                                factory.createShorthandPropertyAssignment(idNode) // Use the identifier node directly for shorthand
                            );
                            const localsObject = factory.createObjectLiteralExpression(objectLiteralProperties, true);
                            newArguments.push(localsObject);
                        }

                        // If there were other original arguments beyond the message (and potentially an existing locals object),
                        // preserve them. This simple version assumes only message, or message + locals.
                        // A more robust version would intelligently merge or replace.
                        // For now, if the original call was just logger.log("message"), we add locals.
                        // If it was logger.log("message", existingLocals), this version might replace existingLocals if node.arguments.length === 1.
                        // Let's refine to only add if it was just the message.
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
                        // For now, we'll leave calls with >1 argument untouched by this specific injection.
                    }
                }
            }
            return ts.visitEachChild(node, visitor, context);
        };
        return (sourceFile: ts.SourceFile) => ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
}