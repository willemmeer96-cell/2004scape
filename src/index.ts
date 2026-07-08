import { loadConfig } from "./config";
import { startGatewayServer } from "./server";

startGatewayServer(loadConfig());
