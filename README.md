# DynamicLogger with TypeScript Transformer

## Motivation

Manually adding variable names into log statements requires code to be re-deployed, which is undesirable. 

Enter DynamicLogger, which accesses the logging code from a database and saves us from the hassle of re-deploying.

## What does the repo contain?

It contains a prototype of the module we envision creating.

## Our approach

Initial idea was to call eval function inside the defintion of logger.log, but that requires the values of local variables to be fed into it since the scope of the function is different from the scope from which the function is called.

One option was to feed the variables we wish to log after fetching from the DB into the log function, but we ruled this out since we wanted to keep the code simple at the user end (as simple as `logger.log(<unique_id>)`).

Another option was to extract variable values from the current stack frame at runtime, which is achieved using `inspect.currentframe().f_locals` in Python. However, in JS there is no means to access the local variable stack frame or its contents at runtime.

So our approach is to construct the list of local variables during the transpilation of TS code to JS code.

This is done by traversing the Abstract Syntax Tree (AST) which is constructed when the TS code is parsed. 

The access to this AST is provided through typescript transformers.

This is the code is doing in a nutshell:

1. From the node corresponding to logger.log, traverse up the AST till you reach a 'scope defining node'.
2. Make a list of the local variables of that scope which were intialized before the log call and inject that list into the log the function.

Hence, the `logger.log("Message")` line in TS file is altered to `logger.log("Message", list_of_vars)` in the transpiled JS file.


## Project Structure

```
typescript-transformer-logger/
├── package.json
├── tsconfig.json       # Configured with the custom transformer
├── logger-config.json  # Runtime logger configuration
│
├── src/
│   ├── dynamicLogger.ts    # The logger class
│   ├── main.ts             # Example usage
│   └── transformers/
│       └── auto-log-vars-transformer.ts # The AST transformer
│
└── dist/                 # Compiled JavaScript output
```

## Installation and running

1.  **Clone the repository (if applicable) or set up your project.**
2.  **Install dependencies:**
    ```bash
    npm install
    npx ts-patch install
    ```

3. **Build and Run:**
    ```bash
    npm run build
    npm run start
    ```

## Configuration


### `logger-config.json`

Change the list of variables in `variablesToLog` to the list of variables whose values are to be logged.

```
{
  ...
  "variablesToLog": [
    "userId",
    "itemId",
    "status",
    "requestData"
  ],
  ...
}
```

## Example usage

```typescript
// src/someModule.ts
import { logger } from './dynamicLogger'; // Adjust path as needed

function processUser(userId: string, data: any) {
    const itemCount = data.items?.length || 0;
    let status = "pending";

    // You write this:
    logger.log("Starting user processing");
    // Transformer changes it to (conceptually):
    // logger.log("Starting user processing", { userId, data, itemCount, status });

    if (itemCount > 10) {
        status = "flagged";
        const reason = "Too many items";
        logger.log("User flagged"); // Will include { userId, data, itemCount, status, reason }
    }
    // ...
}
```

## Further work

*   This code currently uses winston for logging, we have to make the module work for any general logging library. 
*   Adding support for fetching 'what to log' from a database.
*   Adding security checks.
*   Adding custom logging functionality. 
