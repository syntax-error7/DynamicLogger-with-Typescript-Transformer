// dynamicLogger.ts
import { AsyncLocalStorage } from 'async_hooks';
import { validateTSCode } from './validators'; // Import the validator

export const als = new AsyncLocalStorage<Map<string, any>>();
// Imported to include global/request-scoped contextual data (managed by ALS)

// --- Type Definitions ---
interface LoggerConfig {
    VariablesToLog: string[];
    SamplingRate: number;
    PrefixMessage: string;
    CustomLoggingCode?: string; // Optional: TS code string
}

type ConfigFetcher = (uniqueKey: string) => Promise<Partial<LoggerConfig> | null>; 
// Allow partial for flexibility from fetcher
type LogFunction = (logString: string) => void;

interface DynamicLoggerConstructorOptions {
    configFetcher: ConfigFetcher;
    logFunction: LogFunction;
    fetchTimeoutMs?: number; // Optional timeout for config fetching
    verbose?: boolean;       // For internal DynamicLogger debugging
}

class DynamicLogger {
    private static instance: DynamicLogger;

    private configFetcher: ConfigFetcher;
    private logFunction: LogFunction;
    private fetchTimeoutMs: number;
    private internalVerbose: boolean;

    private constructor(options: DynamicLoggerConstructorOptions) {
        this.configFetcher = options.configFetcher;
        this.logFunction = options.logFunction;
        this.fetchTimeoutMs = options.fetchTimeoutMs || 2000; 
        // Default 2s timeout, added just in case something breaks
        this.internalVerbose = !!options.verbose;

        if (this.internalVerbose) {
            console.log(`DynamicLogger Instance Created. Fetch timeout: ${this.fetchTimeoutMs}ms.`);
        }
    }

    /**
     * Initializes and/or returns the singleton instance of DynamicLogger.
     */
    public static DLInitializer(
        configFetcher: ConfigFetcher,
        logFunction: LogFunction,
        options?: Omit<DynamicLoggerConstructorOptions, 'configFetcher' | 'logFunction'>
    ): DynamicLogger {
        if (!DynamicLogger.instance) {
            if (!configFetcher || !logFunction) {
                throw new Error("DynamicLogger: configFetcher and logFunction are required for initialization.");
            }
            DynamicLogger.instance = new DynamicLogger({
                configFetcher,
                logFunction,
                ...options
            });
        }
        return DynamicLogger.instance;
    }

    // Helper to safely get an instance if already initialized, or throw
    public static getInstance(): DynamicLogger {
        if (!DynamicLogger.instance) {
            throw new Error("DynamicLogger: Not initialized. Call DLInitializer first.");
        }
        return DynamicLogger.instance;
    }

    private _serializeValue(value: any): string {
        try {
            let strValue = typeof value === 'string' ? value : JSON.stringify(value);
            return strValue === undefined ? "undefined" : (strValue === null ? "null" : strValue) ;
        } catch {
            return "<unserializable>";
        }
    }

    private _formatLogString(
        uniqueKey: string,
        finalMessage: string,
        variables?: Record<string, any>,
        customCodeOutput?: string // New parameter
    ): string {
        let logString = `Unique Key: [${uniqueKey}] - Message: [${finalMessage}]`;
        if (variables && Object.keys(variables).length > 0) {
            logString += ` - Variable Values: ${JSON.stringify(variables)}`;
        }
        // Add custom code output if present
        if (customCodeOutput !== undefined) { // Check for undefined to allow empty string or null as valid output
            logString += ` - Output of Custom Logging Code: [${customCodeOutput}]`;
        }
        return logString;
    }

    /**
     * Main logging method. Fetches configuration, samples, and logs.
     * @param uniqueKey A unique identifier for this log point.
     * @param metadata This will be appended to the PrefixMessage from LoggerConfig. Typically your primary log message.
     * @param allAvailableLocals An object of all local variables (typically injected by a transformer).
     */
    public async dynamicLog(
        uniqueKey: string,
        metadata?: any, // The user's primary message content, optional
        allAvailableLocals?: Record<string, any>
    ): Promise<void> {
        if (!uniqueKey) {
            console.error("DynamicLogger: uniqueKey is required for dynamicLog.");
            return;
        }

        let fetchedConfig: Partial<LoggerConfig> | null = null;
        try {
            const fetchPromise = this.configFetcher(uniqueKey);
            const timeoutPromise = new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error(`Config fetch for key '${uniqueKey}' timed out after ${this.fetchTimeoutMs}ms.`)), this.fetchTimeoutMs)
            );
            fetchedConfig = await Promise.race([fetchPromise, timeoutPromise]); 
            // Output of fetchedConfig will depend upon which promise (fetchPromise or timeoutPromise) finishes first 
        } catch (error: any) {
            if (this.internalVerbose) {
                console.error(`DynamicLogger: Error fetching or timeout for config key '${uniqueKey}': ${error.message}`);
            }
            return;
        }

        if (!fetchedConfig ||
            typeof fetchedConfig.SamplingRate !== 'number' ||
            !Array.isArray(fetchedConfig.VariablesToLog)
            // PrefixMessage can be optional or default to empty string
        ) {
            if (this.internalVerbose && fetchedConfig !== null) { // Only warn if not a deliberate null
                 console.warn(`DynamicLogger: Invalid or incomplete config for key '${uniqueKey}'. Expected at least {SamplingRate: number, VariablesToLog: string[]}. Logging skipped.`);
            }
            return;
        }

        // Ensure we have a valid LoggerConfig structure for processing
        const config: LoggerConfig = {
            VariablesToLog: fetchedConfig.VariablesToLog,
            SamplingRate: fetchedConfig.SamplingRate,
            PrefixMessage: fetchedConfig.PrefixMessage || "",
            CustomLoggingCode: fetchedConfig.CustomLoggingCode // Keep it, could be undefined
        };


        // --- Sampling Logic ---
        if (config.SamplingRate <= 0 || Math.random() >= config.SamplingRate) {
            if (this.internalVerbose && config.SamplingRate > 0) {
                console.log(`DynamicLogger: Skipped logging for key '${uniqueKey}' due to sampling rate.`);
            }
            return; // Skip logging
        }

        // --- Prepare Variables ---
        const filteredVars: Record<string, any> = {};
        let hasVars = false;

        const contextLocals = { ...allAvailableLocals }; // Start with transformer locals

        // Merges variables from Node.js's AsyncLocalStorage (ALS) into 
        // the set of local variables captured by the transformer.
        const alsStore = als.getStore();
        if (alsStore) {
            alsStore.forEach((value, key) => {
                if (!Object.prototype.hasOwnProperty.call(contextLocals, key)) { 
                    // ALS doesn't override transformer locals
                    contextLocals[key] = value;
                }
            });
        }

        // Filtering variables on the basis of VariablesToLog
        if (Object.keys(contextLocals).length > 0) {
            for (const varName of config.VariablesToLog) {
                if (Object.prototype.hasOwnProperty.call(contextLocals, varName)) {
                    filteredVars[varName] = this._serializeValue(contextLocals[varName]);
                    hasVars = true;
                }
            }
        }

        // --- Prepare Message ---
        const metadataString = (metadata === null || metadata === undefined) ? "" : String(metadata);
        const finalMessage = config.PrefixMessage + metadataString;

        // --- CustomLoggingCode Execution ---
        let customCodeOutputString: string | undefined = "NA"; // Default to NA

        if (config.CustomLoggingCode && typeof config.CustomLoggingCode === 'string' && config.CustomLoggingCode.trim() !== "") {
            // Pass available (filtered or all) locals to the validator so it knows what variables are "safe" to use
            const validationResult = validateTSCode(config.CustomLoggingCode, Object.keys(contextLocals));

            if (validationResult.isValid) {
                try {
                    // Create a function scope for eval to access filteredVars and other context if needed
                    // The 'use strict;' is added here.
                    // We pass `filteredVars` (or `contextLocals` if you want all available) and `als` to the eval context.
                    // Be extremely careful what you expose to eval.
                    const evalContext = {
                        ...contextLocals, // Expose all available locals to the custom code
                        // You could choose to expose only `filteredVars` for more restriction:
                        // ...filteredVars,
                        als: als, // Expose AsyncLocalStorage instance if needed by custom code
                        // Add other safe utilities if necessary
                        Math: Math,
                        JSON: JSON,
                        Date: Date,
                        // Avoid exposing things like `process`, `require`, `fs`
                    };

                    // Dynamically create the function to control scope
                    // The arguments to this new function are the keys from evalContext
                    const argNames = Object.keys(evalContext);
                    const argValues = Object.values(evalContext);

                    const customFunction = new Function(...argNames, `"use strict";\nreturn (${config.CustomLoggingCode});`);
                    const output = customFunction.apply(null, argValues); // `null` for `this` context
                    customCodeOutputString = this._serializeValue(output);
                } catch (evalError: any) {
                    customCodeOutputString = `<EvalError: ${this._serializeValue(evalError.message)}>`;
                    if (this.internalVerbose) {
                        console.error(`DynamicLogger: Error executing CustomLoggingCode for key '${uniqueKey}':`, evalError);
                    }
                }
            } else {
                customCodeOutputString = `<ValidationViolations: ${JSON.stringify(validationResult.violations)}>`;
                if (this.internalVerbose) {
                    console.warn(`DynamicLogger: CustomLoggingCode validation failed for key '${uniqueKey}':`, validationResult.violations);
                }
            }
        }
        // --- End CustomLoggingCode Execution ---

        // --- Format and Log ---
        const logString = this._formatLogString(uniqueKey, finalMessage, hasVars ? filteredVars : undefined, customCodeOutputString);
        try {
            this.logFunction(logString);
        } catch (e: any) {
            console.error("DynamicLogger: Error executing user-provided logFunction:", e.message);
        }
    }
}

// Export the class and necessary types
export { DynamicLogger };
export type { ConfigFetcher, LogFunction };
