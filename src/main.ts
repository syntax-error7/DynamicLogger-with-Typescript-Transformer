// src/main.ts
import { logger, als } from './dynamicLogger'; // Assuming dynamicLogger.ts is in src

async function processData(user: { id: string; items?: string[] }) {
    const userId = user.id; // This should be picked up
    let status = "processing";  // This too
    const items = user.items || [];
    const itemCount = items.length; // And this

    // Developer writes:
    logger.log("Starting data processing for user");
    // Transformer changes to: logger.log("Starting data processing for user", { userId, status, items, itemCount, user });

    await new Promise(resolve => setTimeout(resolve, 50));

    if (itemCount > 2) {
        status = "flagged_for_review";
        const reviewReason = "Too many items"; // New local variable

        // Developer writes:
        logger.log("Item flagged");
        // Transformer changes to: logger.log("Item flagged", { userId, status, items, itemCount, user, reviewReason });
    } else {
        status = "processed_successfully";
    }
    return status;
}

class A {
    static otherThing: number = 5;

    num: number;

    constructor(num: number) {
        this.num = num;
    }

    async doSomething(something: number) : Promise<void> {
        this.num += something;
        logger.log(`num after doing something: ${this.num}`);
    }
}

async function main() {
    console.log("Application started with TypeScript transformer.");

    try {
        await processData({ id: 'user123', items: ['a', 'b', 'c'] });
        logger.log("Processing complete for user123"); 
        
        logger.log("Initializing A...");
        logger.log(`Other thing of A: $(A.otherThing)`);
        const a = new A(19);
        a.doSomething(5);
        logger.log("Finished A....")

    } catch (error: any) {
        logger.log("Error in main execution", { error: error.message });
    } finally {
        await logger.shutdown();
        console.log("Application finished.");
    }
}

main(); 