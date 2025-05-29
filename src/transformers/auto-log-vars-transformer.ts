// auto-log-vars-transformer.ts
import * as ts from 'typescript';

// Define an interface for your plugin options for type safety
interface TransformerOptions {
    verbose?: boolean;
    loggerMethodName?: string; // Optional: Allows user to specify the log method name
}

// Helper to get all identifiers in the current scope that are DECLARED BEFORE the targetNode
function getScopedVariablesDeclaredBeforeNode(
    targetNode: ts.Node,
    typeChecker: ts.TypeChecker,
    factory: ts.NodeFactory,
    options: TransformerOptions
): ts.Identifier[] {
    const identifiers: ts.Identifier[] = [];
    const targetPosition = targetNode.getStart();
    let current: ts.Node | undefined = targetNode;

    // Walk up the AST to find enclosing scopes
    while (current) {
        if (
            ts.isBlock(current) ||
            ts.isSourceFile(current) ||
            ts.isFunctionLike(current) ||
            ts.isModuleBlock(current) ||
            ts.isCaseClause(current) ||
            ts.isDefaultClause(current)
        ) {
            // 1. Handle parameters for function-like declarations
            if (ts.isFunctionLike(current) && current.parameters) {
                current.parameters.forEach(param => {
                    if (ts.isIdentifier(param.name)) {
                        identifiers.push(param.name);
                    } else if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
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
                if (childNode.getEnd() < targetPosition) {
                    if (ts.isVariableStatement(childNode)) {
                        childNode.declarationList.declarations.forEach(declaration => {
                            if (ts.isIdentifier(declaration.name)) {
                                identifiers.push(declaration.name);
                            } else if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
                                declaration.name.elements.forEach(element => {
                                    if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                                        identifiers.push(element.name);
                                    }
                                });
                            }
                        });
                    } else if (ts.isClassDeclaration(childNode) && childNode.name) {
                        identifiers.push(childNode.name);
                    }
                    // Could also handle ts.isFunctionDeclaration(childNode) here if desired
                }
            });
        }
        current = current.parent;
    }

    const seen = new Set<string>();
    const uniqueIdentifiers = identifiers.filter(id => {
        if (seen.has(id.text)) {
            return false;
        }
        seen.add(id.text);
        return true;
    });

    if (options.verbose) {
        console.log(`[TRANSFORMER DEBUG - getScopedVariables] For target node at ${targetPosition}:`);
        identifiers.forEach(id => console.log(`  - Found raw identifier: ${id.text} (pos: ${id.getStart()}-${id.getEnd()})`));
        uniqueIdentifiers.forEach(id => console.log(`  - Unique identifier: ${id.text}`));
    }

    return uniqueIdentifiers;
}


export default function (program: ts.Program, pluginOptions: any): ts.TransformerFactory<ts.SourceFile> {
    const typeChecker = program.getTypeChecker();

    const options: TransformerOptions = {
        verbose: false,
        loggerMethodName: 'dynamicLog', // Default to 'dynamicLog' as per your example
        ...pluginOptions
    };

    if (options.verbose) {
        console.log('[TRANSFORMER LOADED!] Effective Options:', options);
    }

    return (context: ts.TransformationContext) => {
        const factory = context.factory;

        const visitor = (node: ts.Node): ts.Node => {
            if (ts.isCallExpression(node)) {
                const expression = node.expression;
                let isTargetLoggerCall = false;

                if (ts.isPropertyAccessExpression(expression) && expression.name.getText() === options.loggerMethodName) {
                    isTargetLoggerCall = true;
                }

                if (isTargetLoggerCall) {
                    const originalArguments = node.arguments;
                    const uniqueKeyArg = originalArguments[0]; // First argument is always uniqueKey
                    const metadataArg = originalArguments[1];   // Second argument is metadata (optional in source)

                    if (!uniqueKeyArg) { // uniqueKey is mandatory, should not happen in valid TS
                        if (options.verbose) console.warn(`[TRANSFORMER] Skipping dynamicLog call without uniqueKey: ${node.getText()}`);
                        return node;
                    }

                    const scopedVars = getScopedVariablesDeclaredBeforeNode(node, typeChecker, factory, options);

                    if (options.verbose) {
                        console.log(`[TRANSFORMER DEBUG] Processing dynamicLog call: ${node.getText()}`);
                        console.log(`  - Unique Key Arg: ${uniqueKeyArg.getText()}`);
                        console.log(`  - Metadata Arg (present?): ${!!metadataArg}`);
                        console.log(`  - Scoped Vars (${scopedVars.length}):`, scopedVars.map(sv => sv.text));
                    }

                    // Construct the new arguments list
                    const newArguments: ts.Expression[] = [];
                    newArguments.push(uniqueKeyArg); // Always include uniqueKey as first arg

                    // Add metadata argument. If user didn't provide, inject 'undefined'
                    if (metadataArg) {
                        newArguments.push(metadataArg);
                    } else {
                        // User called dLogger.dynamicLog('KEY') (only one argument)
                        // We need to inject 'undefined' for the metadata parameter explicitly
                        // so that our allAvailableLocals goes into the 3rd slot.
                        newArguments.push(factory.createIdentifier('undefined'));
                        if (options.verbose) console.log("  - Injected 'undefined' for optional metadata argument.");
                    }

                    // Add the allAvailableLocals object as the third argument
                    if (scopedVars.length > 0) {
                        const objectLiteralProperties = scopedVars.map(idNode =>
                            factory.createShorthandPropertyAssignment(idNode)
                        );
                        const localsObject = factory.createObjectLiteralExpression(objectLiteralProperties, true);
                        newArguments.push(localsObject);
                        if (options.verbose) {
                            console.log(`  - Injecting localsObject with keys: ${objectLiteralProperties.map(p => (p.name as ts.Identifier).text).join(', ')}`);
                        }
                    } else {
                        // If no scoped vars, inject 'undefined' for the third argument
                        newArguments.push(factory.createIdentifier('undefined'));
                        if (options.verbose) console.log("  - No scoped vars, injected 'undefined' for locals object.");
                    }

                    // Update the CallExpression with the new arguments
                    return factory.updateCallExpression(
                        node,
                        node.expression,
                        node.typeArguments,
                        newArguments
                    );
                }
            }
            return ts.visitEachChild(node, visitor, context);
        };
        return (sourceFile: ts.SourceFile) => ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
}