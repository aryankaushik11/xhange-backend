import { createClient } from "redis";
import { Engine } from "./trade/engine";

async function main() {
    const redisClient = createClient();
    await redisClient.connect();
    
    console.log("Engine Connected to redis");

    const engine = new Engine();

    //check for messages in the queue and process them
    while(true) {
        const response = await redisClient.rPop("messages");
        if(response) {
            engine.process(JSON.parse(response));
        }
        else {

        }
    }
}