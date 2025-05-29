import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { DynamicLogger, ConfigFetcher, LogFunction } from './dynamicLogger';

// Simulating fetcher through if-else statements
const myConfigFetcher: ConfigFetcher = async (key) => {
  await new Promise(r => setTimeout(r, 100)); // to simulate latency
  if (key === "WS") {
    return { VariablesToLog: ["port"], SamplingRate: 1, PrefixMessage: "Testing: " }; // Always logged
  }
  if (key === "SYSTEM_EVENT") {
    return { VariablesToLog: ["port", "currentTime"], SamplingRate: 0.02, PrefixMessage: "System Event - " };
  }
  return null;
};

// Simulating log function through console.log
const myLogFunction: LogFunction = (logString) => {
  console.log("APP_LOG:", logString);
};

// Initialize the logger (typically once at application startup)
const dLogger = DynamicLogger.DLInitializer(myConfigFetcher, myLogFunction);
// Or to get the instance later if already initialized:
// const dLogger = DynamicLogger.getInstance();

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// --- HTTP API Endpoint ---
app.get('/api/message', (req: Request, res: Response) => {
  console.log('GET /api/message received');
  res.json({ message: 'Hello from the API! 👋' });
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server }); // Attach WebSocket server to the HTTP server

wss.on('connection', async (ws: WebSocket) => {
  await dLogger.dynamicLog('WS' ,'Client connected to WebSocket');

  // Send current time every millisecond      
  const timeInterval = setInterval(async () => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        const currentTime = new Date().toLocaleTimeString();
        ws.send(JSON.stringify({ type: 'timeUpdate', time: currentTime }));
        await dLogger.dynamicLog("SYSTEM_EVENT", "Time sent!!")
      } else {
        // If connection is not open, clear interval
        clearInterval(timeInterval);
      }
    } catch (error) {
      console.error('Error sending message via WebSocket:', error);
      clearInterval(timeInterval); // Stop interval on error
    }
  }, 100);

  ws.on('message', (message: string) => {
    console.log(`Received message from client: ${message}`);
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket');
    clearInterval(timeInterval); // Important: clear interval when client disconnects
  });

  ws.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
    clearInterval(timeInterval); // Clear interval on error as well
  });
});

// --- Serve Static HTML Client ---
// This will serve files from the 'public' directory.
// __dirname points to the current directory of the executing script.
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Fallback to index.html for any other GET request not handled by API or static files
// This is useful for single-page applications, though not strictly necessary here.
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) { // Don't redirect API calls
    res.sendFile(path.join(publicPath, 'index.html'));
  } else {
    res.status(404).send('API endpoint not found');
  }
});

// Start the HTTP server
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`API endpoint available at http://localhost:${port}/api/message`);
  console.log(`WebSocket server is listening on port ${port}`);
});


