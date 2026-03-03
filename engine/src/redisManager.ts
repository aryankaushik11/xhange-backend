import { RedisClientType } from "@redis/client";
import { createClient } from "redis";
import { MessageToApi } from "./types/engine";


export class RedisManager {
    private static instance: RedisManager;
    private client: RedisClientType;

    private constructor() {
        this.client = createClient();
        this.client.connect();
    }

    public static getInstance() {
        if(!this.instance) {
            this.instance = new RedisManager();
        }
        return this.instance;
    }

    public sendToApi(channel: string, message: MessageToApi) {
        this.client.publish(channel, JSON.stringify(message));
    }
}