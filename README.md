# DynamicLogger with TypeScript Transformer

`dynamic-logger` automatically injects in-scope local variables into your log calls at compile time.  At runtime, it fetches dynamic configurations (including sampling rates and variables to log) for each unique log point and uses a flexible, user-provided logging function.

## WARNING

This module won't work if you are using a typescript bundler (such as vite, webpack, tsup, esbuild, etc.). The local variables injected by the custom typescript transformer are being removed by the bundler as a part of code cleanup or tree shaking.

## Motivation

Manually adding variable names into log statements requires code to be re-deployed, which is undesirable. 

Enter DynamicLogger, which accesses the logging code from a database and saves us from the hassle of re-deploying.

## What does the repo contain?

It contains a prototype of the module we envision creating. 

## How It Works

1.  **Initialization (`DLInitializer`):**
    *   You initialize `dynamic-logger` once with your custom `configFetcher` and `logFunction`.

2.  **TypeScript Custom Transformer (`auto-log-vars-transformer.ts`):**
    *   During compilation, when this transformer sees `dLogger.dynamicLog("MY_KEY", "Some message");`, it finds local variables (e.g., `user`, `id`) declared before the call.
    *   It modifies the call to: `dLogger.dynamicLog("MY_KEY", "Some message", { user, id });` (The third argument contains all in-scope locals).

3.  **Runtime (`dLogger.dynamicLog` call):**
    *   `dynamic-logger` calls your `configFetcher("MY_KEY")` to get `LoggerConfig` (containing `VariablesToLog`, `SamplingRate`, `PrefixMessage`).
    *   It checks the `SamplingRate`. If `Math.random() < SamplingRate`, it proceeds.
    *   It filters the injected `{ user, id }` object based on `VariablesToLog` from the fetched config.
    *   It constructs a message: "PrefixMessage" + your "Some message".
    *   It formats the final log string: `Unique Key: [MY_KEY] - Message: [Constructed Message] - Variable Values: [{ filtered_user, filtered_id }]`.
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
    type LogFunction
} from 'dynamic-logger'; 

// 1. Define your Configuration Fetcher (Here defined using if-else statements. In a real app, fetch from a database, API, Redis, etc.)
const myConfigFetcher: ConfigFetcher = async (uniqueKey: string): Promise<Partial<LoggerConfig> | null> => {
    if (uniqueKey === "USER_LOGIN_SUCCESS") {
        return {
            VariablesToLog: ["userId", "ipAddress", "sessionDuration"],
            SamplingRate: 0.75, // Log 75% of the time
            PrefixMessage: "Login Event: "
        };
    }
    if (uniqueKey === "ORDER_PROCESSING_ERROR") {
        return {
            VariablesToLog: ["orderId", "errorMessage", "paymentId", "customerDetails"],
            SamplingRate: 1.0, // Always log errors
            PrefixMessage: "CRITICAL ERROR - Order Processing: "
        };
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

### 5. Use the Logger in Your Code

  Import your initialized dLogger instance and use its dynamicLog method.

   ```typescript
  // src/services/authService.ts (in your project)
  import { dLogger } from '../utils/logger'; // Adjust path to your logger setup

  export async function handleLogin(userId: string, ipAddress: string): Promise<boolean> {
      const sessionDuration = 3600; // Example local variable
      let loginSuccessful = false;

      // Some logic...
      loginSuccessful = true; // Simulate successful login

      if (loginSuccessful) {
          await dLogger.dynamicLog(
              "USER_LOGIN_SUCCESS",
              `User ${userId} logged in from ${ipAddress}. Session: ${sessionDuration}s.`
          );
          return true;
      } else {
          const attemptCount = 3; // Another local variable
          await dLogger.dynamicLog(
              "USER_LOGIN_FAILURE", // Different key, different config
              `User ${userId} failed to log in. Attempt: ${attemptCount}.`
          );
          return false;
      }
  }
  ```

Remember:

- The second argument to dLogger.dynamicLog is your main message context (metadata).
- The third argument (local variables) is **automatically injected by the transformer**. You do not type it out.

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
## Example Usage

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
    *   Check the `VariablesToLog` array in your project's uniqueKey to LoggerConfig map.
    *   The transformer only injects variables declared *before* the `dLogger.dynamicLog()` call in the same or an enclosing scope.

---

## Further work

*   Adding security checks.
*   Adding custom logging functionality. 
