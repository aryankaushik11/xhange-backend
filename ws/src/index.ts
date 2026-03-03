import { WebSocketServer } from "ws";

const wss = new WebSocketServer({port: 3003});

wss.on("connection", (ws) => {

})