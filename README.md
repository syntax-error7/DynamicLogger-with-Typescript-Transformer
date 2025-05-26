# DynamicLogger with TypeScript Transformer

`dynamic-logger` automatically injects in-scope local variables into your log calls at compile time, allowing you to dynamically control which variables are logged at runtime via an external configuration file.

## WARNING

This module won't work if you are using a typescript bundler (such as vite, webpack, tsup, esbuild, etc.). The local variables injected by the custom typescript transformer are being removed by the bundler as a part of code cleanup or tree shaking.

## Motivation

Manually adding variable names into log statements requires code to be re-deployed, which is undesirable. 

Enter DynamicLogger, which accesses the logging code from a database and saves us from the hassle of re-deploying.

## What does the repo contain?

It contains a prototype of the module we envision creating.

## How it Works for You

1.  You install `dynamic-logger` and set up your TypeScript project to use its custom transformer.
2.  You write `logger.log("My event occurred");` in your code.
3.  During compilation, the transformer changes this to (conceptually): `logger.log("My event occurred", { localA, localB, paramC });`
4.  At runtime, `dynamic-logger` reads your project's `logger-config.json`.
5.  It filters the injected `{ localA, localB, paramC }` based on the `variablesToLog` array in your config.
6.  Only the desired variables are actually written to your log file.

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
           // "loggerObjectName": "myLogger", // If you imported dLogger as myLogger
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

**a. Add `dynamic-logger` as a dependency:**

   In your project's `package.json`, add `dynamic-logger` to your `dependencies`:

   ```bash
   // your-project/package.json
   {
     "name": "your-project",
     // ...
     "dependencies": {
       "dynamic-logger": "github:arvindf216/DynamicLogger-with-Typescript-Transformer#main", 
       // ... other dependencies
     },
   }
   ```

**b. Configure `typescript` version in `devDependencies`:**

   ```bash
   // your-project/package.json
   {
     // ...
     "devDependencies": {
       // ... other dependencies
       "ts-patch": "^2.0.0",   
       "ts-node": "^10.9.1",
       "typescript": "^4.9.4" // Keep this as typescript version
     }
     // ...
   }
   ```


   Ensure to **keep the typescript version same as "^4.9.4"**, as the file `typescriptServices.js` is often not present in later versions and this file is required by `ts-patch`. `ts-patch` is required to compile your TypeScript code according to the custom transformer specified in the `tsconfig.json` file at build time.


**c. Configure `ts-patch`:**

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
   This will download `dynamic-logger` into your `node_modules/` and run its `prepare` script, which builds the necessary `dist` files including the transformer in the `node-modules/dynamic-logger` directory. The `postinstall` script will install the `ts-patch` tool, whose usability was mentioned earlier. 

### 4. Create `logger-config.json`

   In the **root directory of your project**, create a `logger-config.json` file. This file controls how `dynamic-logger` behaves at runtime.

   ```bash
   // your-project/logger-config.json
   {
     "logFile": "app.log",       // Log file name for your application
     "logLevel": "info",         // e.g., "debug", "info", "warn", "error"
     "enabled": true,            // Master switch for logging
     "variablesToLog": [
       // List the names of local variables FROM YOUR CODE that you want to see
       "userId",
       "orderId",
       "productName",
       "isActive",
       "loopCounter"
       // ... any other variables
     ],
     "checkIntervalSeconds": 10,  // How often to check this file for changes
     "logCallSite": true          // Log [file:line (function)]?
   }
   ```
   Customize `logFile`, `logLevel`, and especially `variablesToLog` according to your application's needs.

### 5. Use the Logger in Your Code

   Import and use the logger in your TypeScript files:

   ```typescript
   // src/services/my-service.ts (in your project)
   import { dLogger } from 'dynamic-logger'; 

   // Any function in your project
   export function processData(userId: string, data: any): void {
     const items = data.items || [];
     const itemCount = items.length;
     let status = "processing";

     // You write this simple log call:
     dLogger.log("Starting data processing for user.");
     // At compile time, it becomes:
     // dLogger.log("Starting data processing for user.", { userId, data, items, itemCount, status, ... });
     // At runtime, if "userId" and "status" are in your logger-config.json's variablesToLog, they will be included in the log output.

     // ... remaining code ...
   }
   ```

### 6. Build and Run Your Project

*   **Build:**
    ```bash
    npm run build
    ```
    This will compile your TypeScript code using the patched `tsc`, applying the `dynamic-logger` transformer. Check your `dist` output to see the transformed `logger.log` calls.

*   **Run:**
    ```bash
    npm run start
    ```

   Observe the log file (e.g., `app.log`) and try changing `logger-config.json` while your application is running to see logging behavior change dynamically!

---

## Troubleshooting

*   **"Could not find a declaration file for module 'dynamic-logger'..."**:
    *   Ensure `dynamic-logger`'s `package.json` has correct `main` and `types` fields pointing to its `dist` files.
    *   Ensure `dynamic-logger`'s `prepare` script ran successfully during `npm install` and created the `.d.ts` file in its `dist` folder within your `node_modules`.
    *   Verify your import statement: `import { logger } from 'dynamic-logger';` (or the correct package name).
*   **Transformer not injecting variables**
    *   Verify `npx ts-patch install` ran successfully in your project (check `postinstall` script).
    *   Ensure your build script uses `tsc` (not `npx tsc`).
    *   Double-check the `"transform"` path in your `tsconfig.json`'s `plugins` section. It must be exact.
*   **Variables logged are not what you expect:**
    *   Check the `variablesToLog` array in your project's `logger-config.json`. Only names listed here (CASE SENSITIVE) will be output.
    *   The transformer only injects variables declared *before* the `logger.log()` call in the same or an enclosing scope.

---

## Further work

*   This code currently uses winston for logging, we have to make the module work for any general logging library. 
*   Adding support for fetching 'what to log' from a database.
*   Adding security checks.
*   Adding custom logging functionality. 
