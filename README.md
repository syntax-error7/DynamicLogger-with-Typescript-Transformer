# DynamicLogger with TypeScript Transformer

`dynamic-logger` automatically injects in-scope local variables into your log calls at compile time.  At runtime, it fetches dynamic configurations (including sampling rates and variables to log) for each unique log point and uses a flexible, user-provided logging function.

## ⚠️ WARNING ⚠️

`dynamic-logger` relies on a TypeScript custom transformer to inject local variables at **compile time** (when `tsc` runs). Most modern JavaScript bundlers (like Webpack, esbuild, tsup, Vite) perform their own optimizations, including tree-shaking and dead code elimination, *after* `tsc` compilation.

**These bundler optimizations will likely remove the local variables injected by the `dynamic-logger` transformer. Therefore, `dynamic-logger` in its current form is best suited for projects where `tsc` is the final step in producing executable JavaScript for a Node.js environment.**

## Motivation

Manually adding variable names into log statements requires code to be re-deployed, which is undesirable. 

Enter DynamicLogger, which accesses the logging configurations (including custom code snippets) from an external source (e.g., a database) at runtime and saves us from the hassle of re-deploying.

## How It Works

1.  **Initialization (`DLInitializer`):**
    *   You initialize `dynamic-logger` once with your custom `configFetcher`(to get configurations) and `logFunction` (to output logs).

2.  **TypeScript Custom Transformer (`auto-log-vars-transformer.ts`):**
    *   During compilation, when this transformer sees `dLogger.dynamicLog("MY_KEY", "Some message");`, it finds local variables (e.g., `user`, `id`) declared before the call.
    *   It modifies the call to: `dLogger.dynamicLog("MY_KEY", "Some message", { user, id });` (The third argument contains all in-scope locals).

3.  **Runtime (`dLogger.dynamicLog` call):**
    *   `dynamic-logger` calls your `configFetcher("MY_KEY")` to get `LoggerConfig`.
    *   `LoggerConfig` contains:
        *   `VariablesToLog: string[]`
        *   `SamplingRate: number` (0.0 to 1.0 probability)
        *   `PrefixMessage: string`
        *   `CustomLoggingCode?: string` (Optional TypeScript/JavaScript code string)
    *   It checks the `SamplingRate`. If `Math.random() < SamplingRate`, it proceeds.
    *   It filters the injected `{ user, id, ... }` object based on `VariablesToLog`.
    *   If `CustomLoggingCode` is present and valid:
        *   It's executed via `eval` with the injected local variables available in its scope.
        *   Its output (or any error/validation messages) is captured.
    *   It constructs a message: `PrefixMessage` + your "Some message" (the `metadata` argument).
    *   It formats the final log string: `Unique Key: [MY_KEY] - Message: [Constructed Message] - Variable Values: [{ filtered_vars }] - Output of Custom Logging Code: [OUTPUT]`.
    *   It passes this string to your `logFunction`.

---

## Using `dynamic-logger` in Your Project

Follow these steps to integrate `dynamic-logger` into your TypeScript application.

### 1. Prerequisites

*   Node.js (LTS version recommended)
*   npm
*   Your project must be a TypeScript project.

### 2. Configure `tsconfig.json`

   Modify your project's `tsconfig.json` to tell the TypeScript compiler to use the `dynamic-logger` transformer.

   ```bash
   // your-project/tsconfig.json
   {
     "compilerOptions": {
       // ... your existing compiler options (target, module, outDir, rootDir, etc.)
       "plugins": [
         {
           // Path to the compiled transformer from the dynamic-logger package
           "transform": "./node_modules/dynamic-logger/dist/transformers/auto-log-vars-transformer.js",
           "type": "program",
           // You can add other options too:
           // "verbose": true, // To control debug statments at build time
         }
         // ... 
       ]
     },
     // ...
   }
   ```
   **Important:** Ensure the `"transform"` path correctly points to the `auto-log-vars-transformer.js` file within the installed `dynamic-logger` package in your `node_modules` directory. (Installation directions are provided below)

### 3. Installation

`dynamic-logger` is installed directly from its GitHub repository.

**a. Add `dynamic-logger` to dependencies:**

   In your project's `package.json`, add `dynamic-logger` to your `dependencies`:

   ```bash
   // your-project/package.json
   {
     "name": "your-project",
     // ...
     "dependencies": {
       "dynamic-logger": "github:syntax-error7/DynamicLogger-with-Typescript-Transformer#main", 
       // ... other dependencies
     },
   }
   ```


**b. Configure `ts-patch` in `package.json` scripts:**

   Add a `postinstall` script to your project's `package.json` to ensure `ts-patch` installation. Also edit the build script so that your TypeScript code is compiled using the patched `tsc`, applying the `dynamic-logger` transformer

   ```bash
   // your-project/package.json
   {
     // ...
     "scripts": {
       "postinstall": "npx ts-patch install -s", // Add this line
       "build": "... && tsc -p tsconfig.json",   // Add this script 
       // ... other scripts
     }
     // ...
   }
   ```

   Then, run:
   ```bash
   npm install
   ```

   This will download `dynamic-logger` into your `node_modules/` and run its `prepare` script, which builds the necessary `dist` files including the transformer in the `node-modules/dynamic-logger` directory. The `postinstall` script will patch your typescript version to allow for custom transformers. 

### 4. Initialize `DynamicLogger` (Once in Your Application)

Create a file (e.g., src/utils/logger.ts or src/logger.ts) to initialize and export your logger instance.

```typescript
// src/utils/logger.ts (in your project)
import {
    DynamicLogger,
    type ConfigFetcher,
    type LogFunction,
    type LoggerConfig
} from 'dynamic-logger'; 

// 1. Define your Configuration Fetcher (Here defined using if-else statements. In a real app, fetch from a database, API, Redis, etc.)
const myConfigFetcher: ConfigFetcher = async (uniqueKey: string): Promise<Partial<LoggerConfig> | null> => {
    if (uniqueKey === "USER_LOGIN_SUCCESS") {
        return {
            VariablesToLog: ["userId", "ipAddress", "sessionDuration"], // Which injected locals to log
            SamplingRate: 0.75, // Log 75% of the time
            PrefixMessage: "Login Event: ", // Prepended to your log metadata
            CustomLoggingCode: `(() => ({ loginType: (userId.includes('@') ? 'email' : 'username'), firstChar: userId[0] }))()`,
            // Custom code to generate additional log data
        }; // Wrapping code in an IIFE
    }
    if (uniqueKey === "USER_LOGIN_FAILURE") {
        return {
            VariablesToLog: ["orderId"],
            SamplingRate: 1.0, // Always log this event
            PrefixMessage: "CRITICAL ERROR - Order Processing: ",
            CustomLoggingCode: `(attemptCount > 2) ? ["Attempt count:", attemptCount] : ["Too less attempts, try more"]` 
        }; // Using ternary operator for simple conditional statements
    }
    // For keys not explicitly defined:
    return { SamplingRate: 0, VariablesToLog: [], PrefixMessage: "" };
};

// 2. Define your Log Function (Here defined using console.log)
const myLogFunction: LogFunction = (logString: string): void => {
    const timestamp = new Date().toISOString();
    console.log(`[MY_APPLICATION_LOG - ${timestamp}] ${logString}`);
};

// 3. Initialize and Export the Logger Instance
// This should be done once when your application starts.
export const dLogger = DynamicLogger.DLInitializer(
    myConfigFetcher,
    myLogFunction
);
```

**Remember:**

- The second argument to `dLogger.dynamicLog` is your main message context (metadata).
- The third argument (local variables) is **automatically injected by the transformer**. You do not type it out.

**Important Notes on `CustomLoggingCode`:**

*   **Execution:** The `CustomLoggingCode` is wrapped and executed like this internally:
    ```typescript
    const output = eval(`return(${CustomLoggingCode})`)
    ```
    The `output` of this execution will appear in your final log string as:
    `... - Output of Custom Logging Code: [OUTPUT]`
    (If `CustomLoggingCode` is not provided or is invalid, `OUTPUT` will be "NA" or an error/validation message).

*   **Requirement: Must Evaluate to a Value:** Your `CustomLoggingCode` string **must be a valid TypeScript expression or an Immediately Invoked Function Expression (IIFE) that returns a value.**
    *   **Simple Expressions / Ternary Operator:** For straightforward logic or conditional values.
        ```typescript
        CustomLoggingCode: `(attemptCount > 2) ? "High attempts: " + attemptCount : "Low attempts"`
        ```
    *   **IIFE for Complex Logic:** For multi-step calculations or more involved conditional logic, wrap your code in an IIFE that explicitly returns a value.
        ```javascript
        // Example:
        CustomLoggingCode: `(() => {
            const userType = userId.includes('@') ? 'emailUser' : 'usernameUser';
            if (sessionDuration > 3600) {
                return { type: userType, session: 'long'};
            }
            return { type: userType, session: 'standard'};
        })()`
        ```

*   **Available Variables:** Inside `CustomLoggingCode`, you have direct access to:
    *   The local variables injected by the `dynamic-logger` transformer (e.g., `userId`, `ipAddress`, `sessionDuration` in the example above).
    *   Standard safe JavaScript global objects (e.g., `Math`, `JSON`, `Date`, `String`, `Array`, `Object`).

*   **Security & Validation:** `dynamic-logger` includes a validator to prevent potentially harmful code (like direct assignments, loops, or access to `process`, `fs`, etc.) from being executed. Ensure your `CustomLoggingCode` adheres to these restrictions. See the "`CustomLoggingCode` Security" section for more details.


### 6. Build and Run Your Project

*   **Build:**
    ```bash
    npm run build
    ```
    This will compile your TypeScript code using the patched `tsc`, applying the `dynamic-logger` transformer. Check your `dist` output to see the transformed `dLogger.dynamicLog` calls.

*   **Run:**
    ```bash
    npm run start
    ```

   Your `myLogFunction` will now receive formatted log strings based on the fetched configurations and sampling rates!

---

## `CustomLoggingCode` Security
The `CustomLoggingCode` string is executed via `eval`. `dynamic-logger` includes a validator (`validators.ts`) that attempts to restrict potentially harmful code patterns (like direct assignments, loops, access to `process` or `fs`).

- **Allowed**: Expressions, calls to safe global objects (`Math`, `JSON`, `String`, etc.), methods on literals (e.g., `"text".toUpperCase()`), and IIFEs (Immediately Invoked Function Expressions) whose bodies also adhere to these rules. Injected local variables are available within the scope of the `CustomLoggingCode`.
- **Disallowed**: `process`, `require`, `eval`, `new Function()`, direct assignments (`x = 5`), loops (`for`, `while`), etc.

**Despite validation, using eval with externally sourced code carries inherent risks. Ensure the source of your CustomLoggingCode is trusted.** The validator is a safeguard, not an absolute guarantee against all malicious intent.

---

## Example Usage (present in this repository)

This section demonstrates how to run the example usage file in the repository, which is a Real-Time Clock application, utilizing Node.js, Express, and WebSockets.

### 1. Clone the Repository

First, clone the project and navigate into its directory:

```bash
git clone https://github.com/syntax-error7/DynamicLogger-with-Typescript-Transformer.git dynamic-logger-example
cd dynamic-logger-example
```

### 2. Install Dependencies

Install all necessary project dependencies. This command will also execute the module's `prepare` script, which compiles the project.

```bash
npm i
```

### 3. Start the Application

Finally, start the example application and observe the logging messages in your console:

```bash
npm run start:example
```
---

## Troubleshooting

*   **"Could not find a declaration file for module 'dynamic-logger'..."**:
    *   Ensure `dynamic-logger`'s `package.json` has correct `main` and `types` fields pointing to its `dist` files.
    *   Ensure `dynamic-logger`'s `prepare` script ran successfully during `npm install` and created the `.d.ts` file in its `dist` folder within your `node_modules`.
*   **Transformer not injecting variables**
    *   Verify `npx ts-patch install` ran successfully in your project (check `postinstall` script).
    *   Ensure your build script uses `tsc` (not `npx tsc`).
    *   Double-check the `"transform"` path in your `tsconfig.json`'s `plugins` section. It must be exact.
*   **Variables logged are not what you expect:**
    *   Check VariablesToLog in the config returned by your configFetcher for the specific uniqueKey.
    *   Ensure CustomLoggingCode is a valid JavaScript expression or an IIFE that returns a value and passes the security validation.
    *   The transformer only injects variables declared *before* the `dLogger.dynamicLog()` call in the same or an enclosing scope.

---

## Further work

*   Allowing more fine-grained control over which injected local variables are exposed to CustomLoggingCode.
* Enhanced validation rules.
