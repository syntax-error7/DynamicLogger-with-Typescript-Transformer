// dynamicLogger.ts
import fs from 'fs';
import path from 'path';
import winston, { Logger as WinstonLogger } from 'winston'; // Assuming winston
import chokidar, {FSWatcher} from 'chokidar'; // For robust file watching
import { AsyncLocalStorage } from 'async_hooks'; // For potential contextual vars

export const als = new AsyncLocalStorage<Map<string, any>>(); // Optional for contextual vars

interface LoggerConfig {
    logFile: string;
    logLevel: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
    enabled: boolean;
    variablesToLog: string[];
    checkIntervalSeconds: number;
    logCallSite: boolean;
    // Add other config options as needed
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'logger-config.json'); // cwd() is often better for CLI tools

class DynamicLogger {
    private static instance: DynamicLogger;
    private configPath: string;
    private config: Partial<LoggerConfig> = {}; // Partial to allow gradual loading
    private winstonLogger: WinstonLogger | null = null;
    private watcher: FSWatcher | null = null;
    private isShuttingDown = false;

    private constructor(configPath: string = DEFAULT_CONFIG_PATH) {
        this.configPath = configPath;
        this._loadConfigSync();
        this._setupWinston();
        this._watchConfig();
        console.log(`DynamicLogger initialized with config: ${this.configPath}`);
    }

    public static getInstance(configPath?: string): DynamicLogger {
        if (!DynamicLogger.instance || (configPath && DynamicLogger.instance.configPath !== configPath)) {
            DynamicLogger.instance = new DynamicLogger(configPath);
        }
        return DynamicLogger.instance;
    }

    private _loadConfigSync(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const fileContent = fs.readFileSync(this.configPath, 'utf-8');
                const newConfig = JSON.parse(fileContent) as Partial<LoggerConfig>;

                if (newConfig.variablesToLog && !Array.isArray(newConfig.variablesToLog)) {
                    console.warn("Warning: 'variablesToLog' in config is not an array. Using previous/default.");
                    newConfig.variablesToLog = this.config.variablesToLog || [];
                }
                this.config = { ...this.config, ...newConfig }; // Merge, new values overwrite old
                console.log('Logger configuration loaded/reloaded:', this.config);
            } else {
                console.warn(`Configuration file ${this.configPath} not found. Using default/previous settings.`);
                if (Object.keys(this.config).length === 0) {
                    this.config = {
                        logFile: "app_default.log",
                        logLevel: "info",
                        enabled: false,
                        variablesToLog: [],
                        checkIntervalSeconds: 10,
                        logCallSite: true,
                    };
                }
            }
        } catch (error: any) {
            console.error(`Error loading config: ${error.message}. Using previous settings.`);
        }
    }

    private _setupWinston(): void {
        if (this.winstonLogger) {
            this.winstonLogger.close();
        }

        const { logFile = 'app.log', logLevel = 'info' } = this.config;

        const logFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(info => {
                let logMessage = `${info.timestamp} - ${info.level.toUpperCase()}:`;
                if (info.callSite) {
                    logMessage += ` ${info.callSite}`;
                }
                logMessage += ` ${info.message}`; // Message comes from the first arg
                if (info.vars && Object.keys(info.vars).length > 0) { // Filtered vars
                    logMessage += ` Vars: ${JSON.stringify(info.vars)}`;
                }
                return logMessage;
            })
        );

        this.winstonLogger = winston.createLogger({
            level: logLevel,
            format: logFormat,
            transports: [
                new winston.transports.File({ filename: logFile, dirname: path.dirname(logFile) || '.' }),
                // new winston.transports.Console({ format: winston.format.simple() })
            ],
            exitOnError: false,
        });
        console.log(`Winston logger configured. Level: ${logLevel}, File: ${logFile}`);
    }

    private _watchConfig(): void {
        if (this.watcher) {
            this.watcher.close();
        }
        this.watcher = chokidar.watch(this.configPath, { persistent: true, ignoreInitial: true, awaitWriteFinish: true })
            .on('change', () => {
                if (this.isShuttingDown) return;
                console.log(`Config file ${this.configPath} changed. Reloading...`);
                this._loadConfigSync();
                this._setupWinston();
            })
            .on('error', (error) => console.error(`Watcher error: ${error}`))
            .on('unlink', () => {
                if (this.isShuttingDown) return;
                console.warn(`Config file ${this.configPath} was unlinked. Using last known config or defaults.`);
            });
    }

    private _getCallSite(): string {
        if (!this.config.logCallSite) return "";
        // ... (same _getCallSite implementation as before using Error.prepareStackTrace)
        // Note: This stack trace will point to the transformed code, which is usually fine.
        // The transformer runs before this, so it's not inspecting its own call.
        const oldPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = (_, stack) => stack;
        const err = new Error();
        const stack = err.stack as any as NodeJS.CallSite[]; // Cast for TS
        Error.prepareStackTrace = oldPrepareStackTrace;

        if (stack && stack.length > 2) { // [0]=_getCallSite, [1]=log, [2]=caller
            const caller = stack[2];
            if (caller) {
                const fileName = path.basename(caller.getFileName() || 'unknown_file');
                const lineNumber = caller.getLineNumber();
                const functionName = caller.getFunctionName() || 'anonymous';
                return `[${fileName}:${lineNumber} (${functionName})]`;
            }
        }
        return "[unknown_call_site]";
    }


    public log(message: string, allAvailableLocals?: Record<string, any>): void {
        if (!this.config.enabled || !this.winstonLogger || this.isShuttingDown) {
            return;
        }

        const varsToActuallyLog = this.config.variablesToLog || [];
        const filteredVars: Record<string, any> = {};
        let hasVars = false;

        // Optional: Get vars from AsyncLocalStorage
        const alsStore = als.getStore();
        if (alsStore) {
            for (const key of varsToActuallyLog) {
                if (alsStore.has(key) && !Object.prototype.hasOwnProperty.call(allAvailableLocals || {}, key)) {
                    // Prioritize explicitly passed locals if names collide
                    try {
                        filteredVars[key] = JSON.stringify(alsStore.get(key)).substring(0, 256); // Simple serialize
                        hasVars = true;
                    } catch { filteredVars[key] = "<unserializable_als>"; }
                }
            }
        }

        // Process variables injected by the transformer (or passed manually if transformer not used)
        if (allAvailableLocals && typeof allAvailableLocals === 'object') {
            for (const key of varsToActuallyLog) {
                if (Object.prototype.hasOwnProperty.call(allAvailableLocals, key)) {
                    try {
                        let value = allAvailableLocals[key];
                        if (typeof value !== 'string') value = JSON.stringify(value);
                        if (value && value.length > 256) value = value.substring(0, 253) + "...";
                        filteredVars[key] = value;
                        hasVars = true;
                    } catch (e) {
                        filteredVars[key] = "<unserializable>";
                        hasVars = true;
                    }
                }
            }
        }

        const logObject: any = { message }; // `any` because Winston's info object is flexible
        if (this.config.logCallSite) {
            logObject.callSite = this._getCallSite();
        }
        if (hasVars) {
            logObject.vars = filteredVars;
        }

        this.winstonLogger.log(this.config.logLevel?.toLowerCase() || 'info', logObject);
    }

    public async shutdown(): Promise<void> {
        console.log("Shutting down DynamicLogger...");
        this.isShuttingDown = true;
        if (this.watcher) {
            await this.watcher.close();
            console.log("Config watcher stopped.");
        }
        if (this.winstonLogger) {
            return new Promise(resolve => {
                this.winstonLogger!.on('finish', () => {
                    console.log("Winston logger flushed and closed.");
                    resolve();
                });
                this.winstonLogger!.end();
            });
        }
    }
}

// Export a singleton instance
export const logger = DynamicLogger.getInstance();