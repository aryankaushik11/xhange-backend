import { RedisManager } from "../redisManager";
import { MessageFromAPI, UserBalance } from "../types/engine";
import { BASE_CURRENCY, Fill, Order } from "../types/orderbook";
import { Orderbook } from "./orderbook";
import fs from "fs";


export class Engine {
    private balances: Map<string, UserBalance> = new Map();
    private orderbooks: Orderbook[] = [];

    constructor() {
        let snapshot = null;
        try {
            if(process.env.WITH_SNAPSHOT) {
                snapshot = fs.readFileSync("./snapshot.json");
            }
        }
        catch(err) {
            console.log("No snapshot found")
        }

        if(snapshot) {
            //if snapshot exists, restore it
            const snapshotSnapshot = JSON.parse(snapshot.toString());
            this.orderbooks = snapshotSnapshot.orderbooks.map((o: any) => new Orderbook(o.baseAsset, o.bids, o.asks, o.lastTradeId, o.currentPrice));
            this.balances = new Map(snapshotSnapshot.balances);
        }
        else {
            //create new orderbooks
            this.orderbooks.push(new Orderbook("SOL",[], [], 0, 0));
            this.orderbooks.push(new Orderbook("BTC", [], [], 0, 0));
            this.orderbooks.push(new Orderbook("ETH", [], [], 0, 0));
            this.orderbooks.push(new Orderbook("SHIB", [], [], 0, 0));
            this.orderbooks.push(new Orderbook("HNT", [], [], 0, 0));

            //add some dummy users
            this.addDummyBalances();
        }

        setInterval(()  => {
            this.saveSnapshot();
        }, 3 * 1000);
    }

    saveSnapshot() {
        const snapshotSnapshot = {
            orderbooks: this.orderbooks.map(o => o.getSnapshot()),
            balances: Array.from(this.balances.entries())
        }
        fs.writeFileSync("./snapshot.json", JSON.stringify(snapshotSnapshot));
    }

    process({ clientId, message }: { clientId: string, message: MessageFromAPI}) {
        const type = message.type;

        switch(type) {
            case "CREATE_ORDER":
                try {
                    const { executedQty, fills, orderId } = this.createOrder(message.data.market, message.data.price, message.data.quantity, message.data.side, message.data.userId);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "ORDER_PLACED",
                        payload: {
                            orderId,
                            executedQty,
                            fills
                        }
                    });
                }
                catch(err) {
                     console.log(err);
                     //publish the msg on client id channel
                     RedisManager.getInstance().sendToApi(clientId, {
                        type: "Error",
                        payload: {
                            message: "Error while placing the order"
                        }
                     });
                }
                break;
            case "CANCEL_ORDER":
                try {
                    const orderId = message.data.orderId;
                    const cancelMkt = message.data.market;
                    const orderbook = this.orderbooks.find(o => o.ticker() === cancelMkt);
                    if(!orderbook)
                        throw new Error("Orderbook not found");

                    const OrderToCancel = orderbook.getOrder(orderId);
                    if(!OrderToCancel)
                        throw new Error("No order found");
                    
                    if(OrderToCancel.side === "buy") {
                        //cancel the bid
                        const price = orderbook.cancelBid(OrderToCancel);
                        //calculate the amount left
                        const leftQty = (OrderToCancel.quantity - OrderToCancel.filled) * OrderToCancel.price;

                        //move the remaining amt from locked back to available
                        //@ts-ignore
                        this.balances.get(OrderToCancel.userId)[BASE_CURRENCY].available += leftQty;
                        //@ts-ignore
                        this.balances.get(OrderToCancel.orderId)[BASE_CURRENCY].locked -= leftQty;
                        if(price) {
                            // send updated depth at.........
                        }
 
                    } else {
                        const price = orderbook.cancelAsk(OrderToCancel);
                        const leftQty = (OrderToCancel.quantity - OrderToCancel.filled) * OrderToCancel.price;
                        //@ts-ignore
                        this.balances.get(order.userId)[quoteAsset].available += leftQuantity;
                        //@ts-ignore
                        this.balances.get(order.userId)[quoteAsset].locked -= leftQuantity;
                        if (price) {
                            // this.sendUpdatedDepthAt(price.toString(), cancelMarket);
                        }
                    }
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "ORDER_CANCELLED",
                        payload: {
                            orderId,
                            executedQty: OrderToCancel.filled,
                            remainingQty: OrderToCancel.quantity - OrderToCancel.filled
                        }
                    })

                }
                catch(err) {
                    console.log("Error while cancelling the order");
                    console.log(err);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "Error",
                        payload: {
                            message: err as string
                        }
                    })
                }
                break;
            case "ON_RAMP":
                this.onRamp(message.data.userId, Number(message.data.amount));
                break;
            case "GET_DEPTH":
                try {
                    const orderbook = this.orderbooks.find(o => o.ticker() === message.data.market);
                    if(!orderbook)
                            throw new Error("Orderbook not found");
                    const depth = orderbook.getDepth();

                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "DEPTH",
                        payload: {
                            market: orderbook.ticker(),
                            bids: depth.bids,
                            asks: depth.asks
                        }
                    });
                }
                catch(err) {
                    console.log(err);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "Error",
                        payload: {
                            message: err as string
                        }
                    });
                }
                break;
            case "GET_OPEN_ORDERS":
                try {
                    const orderbook = this.orderbooks.find(o => o.ticker() === message.data.market);
                    if(!orderbook)
                        throw new Error("Orderbook not found");

                    const openOrders = orderbook.getOpenOrders(message.data.userId);

                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "OPEN_ORDERS",
                        payload: openOrders
                    });
                }
                catch(err) {
                    console.log(err);
                    RedisManager.getInstance().sendToApi(clientId, {
                        type: "Error",
                        payload: {
                            message: err as string
                        }
                    });
                }
                break;
        }
    }

    createOrder(market: string, price: string, quantity: string, side: "buy" | "sell", userId: string) {

        const orderbook = this.orderbooks.find(o => o.ticker() === market);
        if(!orderbook)
            throw new Error("No orderbook found");

        const baseAsset = market.split("_")[0];
        const quoteAsset = market.split("_")[1];

        //check and lock funds of the user
        this.checkAndLockFunds(baseAsset, quoteAsset, side, userId, price, quantity);

        //create order
        const order: Order = {
            price: Number(price),
            quantity: Number(quantity),
            orderId: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
            filled: 0,
            side,
            userId
        }

        //send to orderbook
        const { executedQty, fills } = orderbook.addOrder(order);
        //update balances of the user
        this.updateBalance(userId, quoteAsset, baseAsset, side, executedQty, fills);
        
        //create db trades
        //update db orders
        //publish ws depth updates
        //publish ws trades

        return { executedQty, fills, orderId: order.orderId };
    }

    updateBalance(userId: string, quoteAsset: string, baseAsset: string, side: "buy" | "sell", executedQty: number, fills: Fill[]) {
        
        if(side == "buy") {
            // go through all the fills
            fills.forEach(fill => {
                //update quote asset balance
                
                //@ts-ignore
                this.balances.get(userId)[quoteAsset].locked -= (fill.quantity * fill.price);
                //@ts-ignore
                this.balances.get(fill.otherUserId)[quoteAsset].available += (fill.quantity * fill.price);

                //update asset balance
                //@ts-ignore
                this.balances.get(userId)[baseAsset].available += (fill.quantity * fill.price);
                //@ts-ignore
                this.balances.get(fill.otherUserId)[baseAsset].locked -= (fill.quantity * fill.price);
            });
        }
        else {
            fills.forEach(fill => {
                //update quote asset balance

                //@ts-ignore
                this.balances.get(userId)[quoteAsset].available += (fill.quantity * fill.price);
                //@ts-ignore
                this.balances.get(fill.otherUserId)[quoteAsset].locked -= (fill.quantity * fill.price);
                
                //update base asset balance
                //@ts-ignore
                this.balances.get(userId)[baseAsset].locked -= (fill.quantity * fill.price);
                //@ts-ignore
                this.balances.get(fill.otherUserId)[baseAsset].available += (fill.quantity * fill.price);
            });
        }
    }

    checkAndLockFunds(baseAsset: string, quoteAsset: string, side: "buy" | "sell", userId: string, price: string, quantity: string) {
        //check if the user has sufficient balance and lock it
        
        if(side === "buy") {
            const user = this.balances.get(userId);
            if(!user)
                throw new Error("User not found");
            if(user?.[quoteAsset]?.available < Number(quantity) * Number(price)) {
                throw new Error("Insufficient funds");
            }

            //shift the amount from available to locked balance
            user[quoteAsset].available -= Number(price) * Number(quantity);
            user[quoteAsset].locked += Number(price) * Number(quantity);
        }
        else {
            const user = this.balances.get(userId);
            if(!user)
                    throw new Error("User not found");
            if(user[baseAsset].available < Number(price) * Number(quantity)) {
                throw new Error("Insufficient funds");
            }

            //shift the amount from available to locked
            user[baseAsset].available -= Number(price) * Number(quantity);
            user[baseAsset].locked += Number(price) * Number(quantity);
        }
    }

    onRamp(userId: string, amount: number) {
        const userBalance = this.balances.get(userId);
        if(!userBalance) {
            this.balances.set(userId, {
                [BASE_CURRENCY]: {
                    available: amount,
                    locked: 0
                }
            });
        }
        else {
            userBalance[BASE_CURRENCY].available += amount;
        }
        
    }
    addDummyBalances() {
        this.balances.set("1", {
            [BASE_CURRENCY]: {
                available: 10000,
                locked: 0
            },
            "BTC": {
                available: 0,
                locked: 0
            },
            "SOL": {
                available: 0,
                locked: 0
            },
            "ETH": {
                available: 0,
                locked: 0
            },
            "SHIB": {
                available: 0,
                locked: 0
            },
            "HNT": {
                available: 0,
                locked: 0
            }
        });
        this.balances.set("2", {
            [BASE_CURRENCY]: {
                available: 10000,
                locked: 0
            },
            "BTC": {
                available: 0,
                locked: 0
            },
            "SOL": {
                available: 0,
                locked: 0
            },
            "ETH": {
                available: 0,
                locked: 0
            },
            "SHIB": {
                available: 0,
                locked: 0
            },
            "HNT": {
                available: 0,
                locked: 0
            }
        });
        this.balances.set("3", {
            [BASE_CURRENCY]: {
                available: 10000,
                locked: 0
            },
            "BTC": {
                available: 0,
                locked: 0
            },
            "SOL": {
                available: 0,
                locked: 0
            },
            "ETH": {
                available: 0,
                locked: 0
            },
            "SHIB": {
                available: 0,
                locked: 0
            },
            "HNT": {
                available: 0,
                locked: 0
            }
        });
        this.balances.set("4", {
            [BASE_CURRENCY]: {
                available: 10000,
                locked: 0
            },
            "BTC": {
                available: 0,
                locked: 0
            },
            "SOL": {
                available: 0,
                locked: 0
            },
            "ETH": {
                available: 0,
                locked: 0
            },
            "SHIB": {
                available: 0,
                locked: 0
            },
            "HNT": {
                available: 0,
                locked: 0
            }
        });
        this.balances.set("5", {
            [BASE_CURRENCY]: {
                available: 10000,
                locked: 0
            },
            "BTC": {
                available: 0,
                locked: 0
            },
            "SOL": {
                available: 0,
                locked: 0
            },
            "ETH": {
                available: 0,
                locked: 0
            },
            "SHIB": {
                available: 0,
                locked: 0
            },
            "HNT": {
                available: 0,
                locked: 0
            }
        });
    }
}